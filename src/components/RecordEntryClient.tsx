"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  ArrowLeft, 
  User, 
  Save, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  FileSearch,
  Loader2
} from "lucide-react";
import { LAB_REFERENCE_RANGES, DEPARTMENTS, LAB_TEST_GROUPS } from "@/lib/constants";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  extractDepartmentTextAction,
  extractLabResultValuesAction,
} from "@/app/(dashboard)/department/records/entry/actions";

const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;

interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  gender: string;
  date_of_birth: string;
  contact_number?: string;
  address?: string;
}

interface HistoryItem {
  id: string;
  test_type: string;
  test_name: string;
  test_value: string;
  unit: string | null;
  reference_range_min: number | null;
  reference_range_max: number | null;
  is_flagged: boolean;
  notes: string | null;
  created_at: string;
  recorder?: {
    full_name: string;
  } | null;
}

interface RecordEntryClientProps {
  patient: Patient;
  history: HistoryItem[];
  activeDept: string;
}

interface RecordResult {
  test_name: string;
  test_value: string;
  unit?: string | null;
  reference_range_min?: number | null;
  reference_range_max?: number | null;
  is_flagged: boolean;
}

interface RecordPayload {
  patient_id: string;
  notes: string;
  test_type?: string;
  results: RecordResult[];
}

type LabPanelName = keyof typeof LAB_TEST_GROUPS;

export default function RecordEntryClient({
  patient,
  history,
  activeDept
}: RecordEntryClientProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const labOcrInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [selectedLabTest, setSelectedLabTest] = useState<LabPanelName>("Complete Blood Count (CBC)");
  const [customTestType, setCustomTestType] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [labOcrFile, setLabOcrFile] = useState<File | null>(null);
  const [isExtractingLabValues, setIsExtractingLabValues] = useState(false);
  const [ocrSuggestedParams, setOcrSuggestedParams] = useState<string[]>([]);
  const [departmentTextOcrFile, setDepartmentTextOcrFile] = useState<File | null>(null);
  const [departmentTextOcrTarget, setDepartmentTextOcrTarget] = useState<"findings" | "impression" | null>(null);

  // Lab parameter values & blur validation states
  const [paramValues, setParamValues] = useState<{ [key: string]: string }>({});
  const [paramFlags, setParamFlags] = useState<{ [key: string]: boolean }>({});
  const [paramTouched, setParamTouched] = useState<{ [key: string]: boolean }>({});
  const [outOfRangeConfirm, setOutOfRangeConfirm] = useState<string[]>([]);

  // Imaging / narrative states
  const [findings, setFindings] = useState<string>("");
  const [impression, setImpression] = useState<string>("");

  // Age calculation
  const getAge = (dobString: string) => {
    const dob = new Date(dobString);
    const diff = Date.now() - dob.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  };

  // Check out-of-range status
  const checkRange = (paramName: string, valueStr: string) => {
    const trimmed = valueStr.trim();
    if (!STRICT_NUMBER_REGEX.test(trimmed)) {
      return { isFlagged: false, rangeText: "", isNumeric: false };
    }

    const val = Number(trimmed);
    if (!Number.isFinite(val)) return { isFlagged: false, rangeText: "", isNumeric: false };

    const range = LAB_REFERENCE_RANGES.find(r => r.parameter === paramName);
    if (!range) return { isFlagged: false, rangeText: "", isNumeric: false };

    const isFemale = patient.gender?.toLowerCase() === "female";
    const min = isFemale ? range.femaleMin : range.maleMin;
    const max = isFemale ? range.femaleMax : range.maleMax;

    const isFlagged = val < min || val > max;
    return {
      isFlagged,
      rangeText: `Ref: ${min} - ${max} ${range.unit}`,
      isNumeric: true
    };
  };

  const handleParamChange = (paramName: string, value: string) => {
    setParamValues(prev => ({ ...prev, [paramName]: value }));
  };

  const handleParamBlur = (paramName: string) => {
    const val = paramValues[paramName];
    if (!val) {
      setParamTouched(prev => ({ ...prev, [paramName]: false }));
      setParamFlags(prev => ({ ...prev, [paramName]: false }));
      return;
    }

    const { isFlagged, isNumeric } = checkRange(paramName, val);
    if (!isNumeric) {
      setParamTouched(prev => ({ ...prev, [paramName]: false }));
      setParamFlags(prev => ({ ...prev, [paramName]: false }));
      return;
    }

    setParamTouched(prev => ({ ...prev, [paramName]: true }));
    setParamFlags(prev => ({ ...prev, [paramName]: isFlagged }));
  };

  const isLabPanelName = (value: unknown): value is LabPanelName => {
    return typeof value === "string" && value in LAB_TEST_GROUPS;
  };

  const applyExtractedLabValues = (panel: LabPanelName, values: Record<string, string>) => {
    const allowedParams = LAB_TEST_GROUPS[panel];
    const nextValues: { [key: string]: string } = {};
    const nextTouched: { [key: string]: boolean } = {};
    const nextFlags: { [key: string]: boolean } = {};
    const appliedParams: string[] = [];

    allowedParams.forEach((paramName) => {
      const extractedValue = values[paramName];
      if (!extractedValue || !STRICT_NUMBER_REGEX.test(extractedValue)) return;

      const { isFlagged, isNumeric } = checkRange(paramName, extractedValue);
      if (!isNumeric) return;

      nextValues[paramName] = extractedValue;
      nextTouched[paramName] = true;
      nextFlags[paramName] = isFlagged;
      appliedParams.push(paramName);
    });

    setSelectedLabTest(panel);
    setParamValues(nextValues);
    setParamTouched(nextTouched);
    setParamFlags(nextFlags);
    setOcrSuggestedParams(appliedParams);

    if (appliedParams.length === 0) {
      toast.warning("No supported lab values were found. Please enter results manually.");
      return;
    }

    const expectedCount = allowedParams.length;
    if (appliedParams.length < expectedCount) {
      toast.warning("Some values could not be extracted. Please review and complete the fields manually.");
    } else {
      toast.success(`OCR suggested ${appliedParams.length} value(s). Please verify before saving.`);
    }
  };

  const handleExtractLabValues = async () => {
    if (!labOcrFile) {
      toast.error("Upload a result sheet before extracting values.");
      return;
    }

    setIsExtractingLabValues(true);
    try {
      const data = new FormData();
      data.append("file", labOcrFile);
      data.append("department", activeDept);

      const result = await extractLabResultValuesAction(data);
      if (!result.success) {
        toast.error(result.error || "Failed to extract lab values.");
        return;
      }

      if (!isLabPanelName(result.panel)) {
        setOcrSuggestedParams([]);
        toast.warning("No supported lab values were found. Please enter results manually.");
        return;
      }

      applyExtractedLabValues(result.panel, result.values || {});
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to extract lab values.";
      toast.error(message);
    } finally {
      setIsExtractingLabValues(false);
    }
  };

  const handleExtractDepartmentText = async (targetField: "findings" | "impression") => {
    if (!departmentTextOcrFile) {
      toast.error("Upload a result sheet before extracting text.");
      return;
    }

    setDepartmentTextOcrTarget(targetField);
    try {
      const data = new FormData();
      data.append("file", departmentTextOcrFile);
      data.append("department", activeDept);
      data.append("targetField", targetField);

      const result = await extractDepartmentTextAction(data);
      if (!result.success || !result.text?.trim()) {
        toast.warning(result.error || "Could not extract readable text. Existing text was not changed.");
        return;
      }

      if (targetField === "findings") {
        setFindings(result.text);
      } else {
        setImpression(result.text);
      }

      toast.success(
        `OCR text inserted into ${targetField === "findings" ? "Clinical Findings" : "Diagnostic Impression"}. Please verify before saving.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to extract text.";
      toast.error(message);
    } finally {
      setDepartmentTextOcrTarget(null);
    }
  };

  // Submit Handler
  const submitRecords = async (skipOutOfRangeConfirm = false) => {
    try {
      const payload: RecordPayload = {
        patient_id: patient.id,
        notes,
        results: []
      };

      if (activeDept === "laboratory") {
        payload.test_type = selectedLabTest;
        const activeParams = LAB_TEST_GROUPS[selectedLabTest as keyof typeof LAB_TEST_GROUPS] || [];
        
        // Validate at least one parameter is entered
        const enteredParams = activeParams.filter(p => paramValues[p] !== undefined && paramValues[p] !== "");
        if (enteredParams.length === 0) {
          toast.error("Please enter at least one test value");
          setIsSubmitting(false);
          return;
        }

        const outOfRangeValues: string[] = [];

        payload.results = enteredParams.map(paramName => {
          const range = LAB_REFERENCE_RANGES.find(r => r.parameter === paramName);
          const isFemale = patient.gender?.toLowerCase() === "female";
          const min = range ? (isFemale ? range.femaleMin : range.maleMin) : null;
          const max = range ? (isFemale ? range.femaleMax : range.maleMax) : null;
          const val = paramValues[paramName];
          const { isFlagged, rangeText } = checkRange(paramName, val);

          if (isFlagged) {
            outOfRangeValues.push(`${paramName}: ${val} (${rangeText})`);
          }

          return {
            test_name: paramName,
            test_value: val,
            unit: range?.unit || null,
            reference_range_min: min,
            reference_range_max: max,
            is_flagged: isFlagged
          };
        });

        if (outOfRangeValues.length > 0 && !skipOutOfRangeConfirm) {
          setOutOfRangeConfirm(outOfRangeValues);
          return;
        }
      } else {
        // Imaging / Ultrasound / ECG
        const resolvedTestType = customTestType.trim();
        if (!resolvedTestType) {
          toast.error("Test name (e.g. Chest X-Ray) is required");
          setIsSubmitting(false);
          return;
        }
        if (!findings.trim()) {
          toast.error("Findings is required");
          setIsSubmitting(false);
          return;
        }
        if (!impression.trim()) {
          toast.error("Impression is required");
          setIsSubmitting(false);
          return;
        }

        payload.test_type = resolvedTestType;
        payload.results = [
          {
            test_name: "Findings",
            test_value: findings.trim(),
            is_flagged: false
          },
          {
            test_name: "Impression",
            test_value: impression.trim(),
            is_flagged: false
          }
        ];
      }

      setIsSubmitting(true);
      // POST to API
      const res = await fetch("/api/department/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to save records");
      }

      toast.success("Results saved and queue updated successfully!");
      router.push(`/department/records?department=${activeDept}`);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error submitting results";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitRecords(false);
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 animate-fade-in">
      {/* Top navigation back */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push(`/department/records?department=${activeDept}`)}
          className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-slate-600 dark:text-slate-400"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
            Result Entry Form
          </h1>
          <p className="text-xs text-slate-500">
            {DEPARTMENTS[activeDept as keyof typeof DEPARTMENTS]?.label || activeDept} Department Portal
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left column: Patient Info + History (1 span) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Patient Details Card */}
          <div className="p-5 border border-slate-200/80 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
                <User className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {patient.first_name} {patient.last_name}
                </h3>
                <p className="text-xs text-slate-500 uppercase font-semibold">
                  Patient ID: {patient.id.substring(0, 8)}...
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 text-xs border-t border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-slate-400 block">Gender</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 capitalize">
                  {patient.gender}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Age / DOB</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {getAge(patient.date_of_birth)} yrs • {patient.date_of_birth}
                </span>
              </div>
            </div>
          </div>

          {/* Patient Department History */}
          <div className="p-5 border border-slate-200/80 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-teal-600" />
              Previous Department Findings
            </h3>

            {history.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No previous results on file for this patient.</p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {history.map((h) => {
                  const dateStr = format(new Date(h.created_at), "yyyy-MM-dd");
                  return (
                    <div key={h.id} className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{h.test_type}</span>
                        <span className="text-[10px] text-slate-400">{dateStr}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">{h.test_name}:</span>
                        <span className={`font-semibold ${h.is_flagged ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-300"}`}>
                          {h.test_value} {h.unit || ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: Form (2 spans) */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="p-6 border border-slate-200/80 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-sm space-y-6">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
              Enter Clinical Values
            </h2>

            {/* Department Custom UI */}
            {activeDept === "laboratory" ? (
              // --- LABORATORY FORM ---
              <div className="space-y-6 animate-fade-in">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Select Test Panel
                  </label>
                  <select
                    value={selectedLabTest}
                    onChange={(e) => {
                      setSelectedLabTest(e.target.value as LabPanelName);
                      setParamValues({});
                      setParamFlags({});
                      setParamTouched({});
                      setOcrSuggestedParams([]);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 font-medium"
                  >
                    <option value="Complete Blood Count (CBC)">Complete Blood Count (CBC)</option>
                    <option value="Fasting Blood Sugar (FBS)">Fasting Blood Sugar (FBS)</option>
                    <option value="Renal Function">Renal Function (Creatinine)</option>
                    <option value="Lipid Profile">Lipid Profile (Cholesterol)</option>
                  </select>
                </div>

                <div className="rounded-2xl border border-teal-100 dark:border-teal-900/40 bg-teal-50/40 dark:bg-teal-950/10 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300">
                      <FileSearch className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        OCR Autofill from Result Sheet
                      </h3>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Upload a lab result photo, PNG, JPG, or PDF. Extracted values are suggestions only.
                        Verify and edit every value before saving.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      ref={labOcrInputRef}
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      disabled={isExtractingLabValues || isSubmitting}
                      onChange={(e) => {
                        setLabOcrFile(e.target.files?.[0] || null);
                        setOcrSuggestedParams([]);
                      }}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white disabled:opacity-50"
                    />
                    <Button
                      type="button"
                      onClick={handleExtractLabValues}
                      disabled={!labOcrFile || isExtractingLabValues || isSubmitting}
                      className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
                    >
                      {isExtractingLabValues ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Extracting values...
                        </>
                      ) : (
                        "Extract Values from Result Sheet"
                      )}
                    </Button>
                  </div>

                  {ocrSuggestedParams.length > 0 && (
                    <p className="text-xs font-medium text-teal-800 dark:text-teal-200">
                      OCR suggested {ocrSuggestedParams.length} field(s): {ocrSuggestedParams.join(", ")}.
                      Review all values before clicking Save Results.
                    </p>
                  )}
                </div>

                {/* Parameters List */}
                <div className="space-y-4 pt-2">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Panel Parameters
                  </h3>

                  {(LAB_TEST_GROUPS[selectedLabTest as keyof typeof LAB_TEST_GROUPS] || []).map((paramName) => {
                    const value = paramValues[paramName] || "";
                    const range = LAB_REFERENCE_RANGES.find(r => r.parameter === paramName);
                    const isFemale = patient.gender?.toLowerCase() === "female";
                    const min = range ? (isFemale ? range.femaleMin : range.maleMin) : 0;
                    const max = range ? (isFemale ? range.femaleMax : range.maleMax) : 0;
                    const unit = range?.unit || "";

                    const touched = paramTouched[paramName];
                    const isFlagged = paramFlags[paramName];

                    // Class highlights on blur
                    let inputClass = "focus:ring-2 focus:ring-teal-500 border-slate-200 dark:border-slate-800";
                    if (touched) {
                      inputClass = isFlagged
                        ? "border-red-500 bg-red-50/20 text-red-900 dark:text-red-400 focus:ring-red-500"
                        : "border-green-500 bg-green-50/10 text-green-900 dark:text-green-400 focus:ring-green-500";
                    }

                    return (
                      <div key={paramName} className="space-y-1.5 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/20">
                        <div className="flex justify-between items-center">
                          <label className="text-sm font-bold text-slate-800 dark:text-slate-200">
                            {paramName}
                          </label>
                          <span className="text-xs text-slate-400 font-medium">
                            Ref Range: {min} - {max} {unit}
                          </span>
                        </div>

                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            placeholder={`Enter value (e.g. ${min + (max-min)/2})`}
                            value={value}
                            onChange={(e) => handleParamChange(paramName, e.target.value)}
                            onBlur={() => handleParamBlur(paramName)}
                            className={`w-full pr-16 pl-4 py-2.5 text-sm rounded-xl border bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none transition-all ${inputClass}`}
                          />
                          {unit && (
                            <span className="absolute right-4 top-3 text-xs font-semibold text-slate-400 dark:text-slate-500 pointer-events-none">
                              {unit}
                            </span>
                          )}
                        </div>

                        {/* Status notification */}
                        {touched && (
                          <div className="flex items-center gap-1.5 text-xs pt-1">
                            {isFlagged ? (
                              <>
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                                <span className="text-red-600 dark:text-red-400 font-bold">
                                  Out of Range (Abnormal)
                                </span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                <span className="text-green-600 dark:text-green-400 font-bold">
                                  Normal
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // --- IMAGING / ULTRASOUND / ECG FORM ---
              <div className="space-y-5 animate-fade-in">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Test Name / Modality
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={
                      activeDept === "imaging" 
                        ? "e.g. Chest X-Ray" 
                        : activeDept === "ultrasound" 
                        ? "e.g. Pelvic Ultrasound" 
                        : "e.g. 12-Lead ECG"
                    }
                    value={customTestType}
                    onChange={(e) => setCustomTestType(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="rounded-2xl border border-cyan-100 dark:border-cyan-900/50 bg-cyan-50/60 dark:bg-cyan-950/20 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-xl bg-cyan-100 dark:bg-cyan-900/50 p-2">
                      <FileSearch className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        Extract Text from Result Sheet
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        OCR text is a draft. Verify extracted text, especially handwritten sheets, before saving.
                      </p>
                    </div>
                  </div>

                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    disabled={!!departmentTextOcrTarget || isSubmitting}
                    onChange={(e) => setDepartmentTextOcrFile(e.target.files?.[0] || null)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white disabled:opacity-50"
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => handleExtractDepartmentText("findings")}
                      disabled={!departmentTextOcrFile || !!departmentTextOcrTarget || isSubmitting}
                      className="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-semibold"
                    >
                      {departmentTextOcrTarget === "findings" ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Extracting...
                        </>
                      ) : (
                        "Extract to Findings"
                      )}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleExtractDepartmentText("impression")}
                      disabled={!departmentTextOcrFile || !!departmentTextOcrTarget || isSubmitting}
                      className="bg-cyan-700 hover:bg-cyan-800 text-white text-xs font-semibold"
                    >
                      {departmentTextOcrTarget === "impression" ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Extracting...
                        </>
                      ) : (
                        "Extract to Impression"
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Clinical Findings
                  </label>
                  <textarea
                    required
                    rows={6}
                    placeholder="Enter detailed observation / study findings here..."
                    value={findings}
                    onChange={(e) => setFindings(e.target.value)}
                    className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    Diagnostic Impression
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="Enter overall medical impression..."
                    value={impression}
                    onChange={(e) => setImpression(e.target.value)}
                    className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            )}

            {/* General Notes (Unified) */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Technician Notes (Optional)
              </label>
              <textarea
                rows={3}
                placeholder="Any additional notes or comments regarding patient status or equipment..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => router.push(`/department/records?department=${activeDept}`)}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-sm hover:shadow-md disabled:opacity-50 transition-all"
              >
                <Save className="h-4 w-4" />
                {isSubmitting ? "Saving..." : "Save Results"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <Dialog open={outOfRangeConfirm.length > 0} onOpenChange={(open) => !open && setOutOfRangeConfirm([])}>
        <DialogContent className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Out-of-Range Values</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              One or more values are outside the normal reference range. Do you want to save these results as flagged?
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
            {outOfRangeConfirm.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOutOfRangeConfirm([])}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={async () => {
                setOutOfRangeConfirm([]);
                await submitRecords(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Save Flagged Results
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
