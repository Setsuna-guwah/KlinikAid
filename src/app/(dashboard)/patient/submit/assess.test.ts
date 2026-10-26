import { beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  auth: vi.fn(),
  patient: vi.fn(),
  consent: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
  ocr: vi.fn(),
  logEvent: vi.fn(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: f.auth },
    from: (table: string) =>
      table === 'patients'
        ? { select: () => ({ eq: () => ({ single: f.patient }) }) }
        : { insert: f.insert },
    storage: { from: () => ({ upload: f.upload, remove: f.remove }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/auth/privacy-consent', () => ({ privacyConsentError: f.consent }));
vi.mock('@/lib/logger', () => ({ logEvent: f.logEvent }));
vi.mock('@/lib/documents/extractDocumentText', () => ({ extractDocumentText: f.ocr }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// after() only runs inside a request; tests run the registered callbacks by hand.
vi.mock('next/server', () => ({ after: (callback: () => unknown) => f.afterCallbacks.push(callback) }));

import { assessDocumentQualityAction } from './actions';

const OCR_TEXT = 'Complete Blood Count (CBC) ordered by Dr. Reyes';

function pdfForm() {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([37, 80, 68, 70, 45])], 'request.pdf', { type: 'application/pdf' }));
  return form;
}

async function runAfterCallbacks() {
  const callbacks = f.afterCallbacks.splice(0);
  for (const callback of callbacks) await callback();
}

describe('assessDocumentQualityAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.afterCallbacks.length = 0;
    f.auth.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null });
    f.consent.mockResolvedValue(null);
    f.patient.mockResolvedValue({ data: { id: 'patient' }, error: null });
    f.upload.mockResolvedValue({ data: { path: 'stored' }, error: null });
    f.insert.mockResolvedValue({ error: null });
    f.remove.mockResolvedValue({ error: null });
    f.ocr.mockResolvedValue({ text: OCR_TEXT, promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
    f.logEvent.mockResolvedValue({ ok: true });
  });

  it('does not store the file or call the model when the consent gate refuses', async () => {
    f.consent.mockResolvedValue('Please accept the Data Privacy Agreement before using this feature.');

    const result = await assessDocumentQualityAction(pdfForm());

    expect(result.success).toBe(false);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.ocr).not.toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled();
  });

  it('stores the file and records the pending row with the extracted text', async () => {
    const result = await assessDocumentQualityAction(pdfForm());

    expect(result).toMatchObject({ success: true, isOcrTextEmpty: false, detectedTests: [{ id: 'cbc' }] });
    expect(f.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^owner\/pending-submissions\/[0-9a-f-]{36}\/source\.pdf$/),
      expect.any(Buffer),
      { contentType: 'application/pdf', upsert: false },
    );
    expect(f.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'owner', patient_id: 'patient', ocr_text: OCR_TEXT }));
  });

  it('writes the OCR audit row after the response, with the same metadata as before', async () => {
    await assessDocumentQualityAction(pdfForm());

    expect(f.logEvent).not.toHaveBeenCalled();
    await runAfterCallbacks();

    expect(f.logEvent).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'DOCUMENT_OCR_PROCESSED',
      'Document OCR processed via Google Generative AI',
      null,
      expect.objectContaining({ assessment_id: expect.any(String), total_token_count: 15 }),
    );
  });

  it('leaves no pending row and no audit row when the stored copy fails to upload', async () => {
    f.upload.mockResolvedValue({ data: null, error: { message: 'bucket unavailable' } });

    const result = await assessDocumentQualityAction(pdfForm());

    expect(result).toEqual({ success: false, error: 'Failed to upload file for assessment: bucket unavailable' });
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.afterCallbacks).toHaveLength(0);
    expect(f.logEvent).not.toHaveBeenCalled();
  });

  it('removes the stored copy when the pending row cannot be saved', async () => {
    f.insert.mockResolvedValue({ error: { message: 'insert failed' } });

    const result = await assessDocumentQualityAction(pdfForm());

    expect(result).toEqual({ success: false, error: 'Failed to save document assessment. Please try again.' });
    expect(f.remove).toHaveBeenCalledWith([expect.stringMatching(/\/source\.pdf$/)]);
  });

  it('treats a failed model call as unreadable text, not as a failed upload', async () => {
    f.ocr.mockResolvedValue(null);

    const result = await assessDocumentQualityAction(pdfForm());

    expect(f.upload).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, isOcrTextEmpty: true, detectedTests: [] });
    expect(f.afterCallbacks).toHaveLength(0);
  });
});
