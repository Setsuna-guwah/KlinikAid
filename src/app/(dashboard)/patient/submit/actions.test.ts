import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ submit: vi.fn(), lookup: vi.fn(), pending: vi.fn(), listing: vi.fn(), file: vi.fn(), auth: vi.fn(), profile: vi.fn(), patient: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({auth:{getUser:f.auth},from:()=>({select:()=>({eq:()=>({single:f.patient})})})}) }));
vi.mock('@/lib/supabase/admin', () => ({createAdminClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:f.profile})})})})}));
vi.mock('@/lib/auth/privacy-consent',()=>({privacyConsentError:async()=>null}));
vi.mock('@/lib/documents/uploadStore',()=>({uploadStore:()=>({pending:f.pending,listing:f.listing,file:f.file,submit:f.submit,lookup:f.lookup})}));
vi.mock('next/cache',()=>({revalidatePath:f.revalidate}));
vi.mock('@/lib/logger',()=>({logEvent:vi.fn()}));
import { confirmSubmitDocumentAction } from './actions';
const id='11111111-1111-4111-8111-111111111111';
describe('web assessed upload uses shared transaction',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    f.auth.mockResolvedValue({data:{user:{id:'owner',email_confirmed_at:'yes',app_metadata:{}}}});
    f.profile.mockResolvedValue({data:{is_active:true,roles:{name:'patient',is_system:true,base_role:null}},error:null});
    f.patient.mockResolvedValue({data:{id:'patient'},error:null});
    f.pending.mockResolvedValue({id,user_id:'owner',patient_id:'patient',file_name:'request.png',file_type:'image/png',file_path:`owner/pending-submissions/${id}/source.png`,ocr_text:'CBC'});
    f.listing.mockResolvedValue([{name:'source.png',id,metadata:{size:8,mimetype:'image/png'}}]);
    f.file.mockResolvedValue(Object.assign(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'}),{objectSnapshot:{id,metadata:{size:8,mimetype:'image/png'}}}));
    f.submit.mockResolvedValue({outcome:'created',document_id:'document'});
  });
  it('reads the assessment folder once and hands the source object to the file read',async()=>{
    expect(await confirmSubmitDocumentAction(id,['cbc'],'lab-request')).toMatchObject({success:true});
    expect(f.listing).toHaveBeenCalledWith('owner',id);
    expect(f.file).toHaveBeenCalledWith(`owner/pending-submissions/${id}/source.png`,{name:'source.png',id,metadata:{size:8,mimetype:'image/png'}});
  });
  it('refuses when the folder listing fails for an existing row, without writing',async()=>{
    f.listing.mockRejectedValue(new Error('storage down'));
    expect(await confirmSubmitDocumentAction(id,['cbc'])).toMatchObject({success:false,errorCode:'SERVER_ERROR'});
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('refuses when the folder does not hold the pending source file',async()=>{
    f.listing.mockResolvedValue([{name:'other.png',id,metadata:{size:8,mimetype:'image/png'}}]);
    f.file.mockResolvedValue(null);
    expect(await confirmSubmitDocumentAction(id,['cbc'])).toMatchObject({success:false,errorCode:'FIELD_INVALID'});
    expect(f.file).toHaveBeenCalledWith(expect.any(String),undefined);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('uses server-created assessment ID as stable request and attributes the shared transaction',async()=>{
    expect(await confirmSubmitDocumentAction(id,['cbc'],'lab-request')).toEqual({success:true,documentId:'document'});
    expect(f.submit).toHaveBeenCalledWith(expect.objectContaining({user_id:'owner',patient_id:'patient',request_id:id,assessment_id:id,
      metadata:expect.objectContaining({document_type:'lab-request',selected_tests:[{id:'cbc',label:'Complete Blood Count (CBC)'}]})}));
    expect(f.revalidate).toHaveBeenCalledTimes(2);
  });
  it('replays a consumed assessment without copying/removing any file',async()=>{
    f.pending.mockResolvedValue(null); f.submit.mockResolvedValue({outcome:'replayed',document_id:'original'});
    expect(await confirmSubmitDocumentAction(id)).toEqual({success:true,documentId:'original'});
    expect(f.file).not.toHaveBeenCalled();
  });
  it('preserves selection intent when none of the detected tests were selected',async()=>{
    expect(await confirmSubmitDocumentAction(id,[])).toMatchObject({success:false,errorCode:'FIELD_REQUIRED'});
    expect(f.submit).not.toHaveBeenCalled();
  });
  for(const [outcome,errorCode] of [['duplicate','DUPLICATE_PENDING'],['conflict','IDEMPOTENCY_CONFLICT'],['expired','RECONCILIATION_REQUIRED'],['withdrawn','RECONCILIATION_REQUIRED'],['assessment_not_found','ASSESSMENT_NOT_FOUND']]) {
    it(`reports ${outcome} without a second audit or destructive cleanup`,async()=>{
      f.submit.mockResolvedValue({outcome,document_id:'old',status:'pending'});
      expect(await confirmSubmitDocumentAction(id)).toMatchObject({success:false,errorCode});
      expect(f.submit).toHaveBeenCalledTimes(1); expect(f.revalidate).not.toHaveBeenCalled();
    });
  }
  it('rejects non-patient role_id and inactive profiles',async()=>{
    f.profile.mockResolvedValue({data:{is_active:true,roles:{name:'staff',is_system:true}}});
    expect(await confirmSubmitDocumentAction(id)).toMatchObject({success:false}); expect(f.pending).not.toHaveBeenCalled();
  });
});
