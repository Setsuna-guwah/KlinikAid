"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  ArrowLeft, 
  Activity, 
  Save, 
  AlertCircle, 
  Info,
  ShieldCheck 
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LAB_REFERENCE_RANGES } from "@/lib/constants";
import { createSpecialistRecordAction } from "@/app/(dashboard)/specialist/patients/[patientId]/actions";

const STRICT_NUMBER_REGEX = /^-?\d+(\.\d+)?$/;

const LAB_TEST_GROUPS = {
  "Complete Blood Count (CBC)": ["Hemoglobin", "White Blood Cells (WBC)", "Platelets"],
  "Fasting Blood Sugar (FBS)": ["Fasting Blood Sugar (FBS)"],
  "Renal Function": ["Creatinine"],
  "Lipid Profile": ["Cholesterol"]
};

interface PatientData {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  contact_number: string | null;
  email: string | null;
  address: string | null;
}

interface SpecialistRecordEntryClientProps {
  patient: PatientData;
}

export default function SpecialistRecordEntryClient({ patient }: SpecialistRecordEntryClientProps) {
  const router = useRouter();
  const [selectedTestType, setSelectedTestType] = useState<string>("Complete Blood Count (CBC)");
  const [notes, setNotes] = useState("");
  const [paramValues, setParamValues] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [outOfRangeConfirm, setOutOfRangeConfirm] = useState<string[]>([]);


  // Range checker for visual alerts
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

  const handleParamChange = (paramName: string, val: string) => {
    setParamValues(prev => ({ ...prev, [paramName]: val }));
  };

  const submitRecord = async (skipOutOfRangeConfirm = false) => {
    try {
      const activeParams = LAB_TEST_GROUPS[selectedTestType as keyof typeof LAB_TEST_GROUPS] || [];
      const enteredResults = activeParams
        .filter(p => paramValues[p] !== undefined && paramValues[p] !== "")
        .map(paramName => ({
          test_name: paramName,
          test_value: paramValues[paramName]
        }));

      if (enteredResults.length === 0) {
        toast.error("Please enter at least one value for the selected test group.");
        setIsSubmitting(false);
        return;
      }

      const outOfRangeValues = enteredResults
        .map((result) => {
          const { isFlagged, rangeText } = checkRange(result.test_name, result.test_value);
          return isFlagged ? `${result.test_name}: ${result.test_value} (${rangeText})` : null;
        })
        .filter((value): value is string => value !== null);

      if (outOfRangeValues.length > 0 && !skipOutOfRangeConfirm) {
        setOutOfRangeConfirm(outOfRangeValues);
        return;
      }

      setIsSubmitting(true);
      const res = await createSpecialistRecordAction(patient.id, {
        test_type: selectedTestType,
        notes,
        results: enteredResults
      });

      if (res.success) {
        toast.success("Clinical record saved successfully.");
        router.push("/specialist/patients");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to save record");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitRecord(false);
  };

  const activeParams = LAB_TEST_GROUPS[selectedTestType as keyof typeof LAB_TEST_GROUPS] || [];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back to list */}
      <div>
        <Link 
          href="/specialist/patients" 
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Private Directory
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-600" />
            Enter Private Record
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Log clinical data for <span className="font-semibold text-slate-700 dark:text-slate-400">{patient.last_name}, {patient.first_name}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5 rounded-lg border border-emerald-100 dark:border-emerald-900/10">
          <ShieldCheck className="h-4 w-4" />
          End-to-End Isolated
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800">
            <CardTitle className="text-sm font-semibold">Test Details</CardTitle>
            <CardDescription className="text-xs">
              Select the diagnostic parameter group and record values.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Test Group Selector */}
            <div className="space-y-2">
              <Label className="text-xs font-bold">Diagnostic Group</Label>
              <select
                value={selectedTestType}
                onChange={(e) => {
                  setSelectedTestType(e.target.value);
                  setParamValues({});
                }}
                className="w-full pl-3 pr-8 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 h-10 appearance-none"
              >
                {Object.keys(LAB_TEST_GROUPS).map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* Parameters list */}
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Parameters</h3>
              <div className="space-y-4">
                {activeParams.map(paramName => {
                  const val = paramValues[paramName] || "";
                  const { isFlagged, rangeText, isNumeric } = checkRange(paramName, val);

                  return (
                    <div key={paramName} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center border-b border-slate-50 dark:border-slate-900 pb-3">
                      <div className="md:col-span-4">
                        <Label htmlFor={`param-${paramName}`} className="text-xs font-semibold text-slate-700 dark:text-slate-400">
                          {paramName}
                        </Label>
                        {rangeText && (
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{rangeText}</p>
                        )}
                      </div>
                      <div className="md:col-span-4 relative">
                        <Input
                          id={`param-${paramName}`}
                          type="number"
                          step="any"
                          placeholder="Enter value"
                          value={val}
                          onChange={(e) => handleParamChange(paramName, e.target.value)}
                          className={`text-xs h-9 ${
                            isFlagged 
                              ? "border-red-500 focus-visible:ring-red-500/25" 
                              : val 
                                ? "border-emerald-500 focus-visible:ring-emerald-500/25" 
                                : ""
                          }`}
                        />
                      </div>
                      <div className="md:col-span-4 flex items-center gap-2">
                        {isFlagged ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded border border-red-100 dark:border-red-900/10">
                            <AlertCircle className="h-3 w-3" />
                            Out of Range
                          </span>
                        ) : val && isNumeric ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/10">
                            Normal
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Info className="h-3.5 w-3.5 text-slate-400" />
                            Reference matches {patient.gender}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2 pt-2">
              <Label htmlFor="notes" className="text-xs font-bold">Clinical Notes</Label>
              <Textarea
                id="notes"
                placeholder="Enter patient diagnosis summary or notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs min-h-[80px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/specialist/patients")}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {isSubmitting ? "Saving..." : "Save Record"}
          </Button>
        </div>
      </form>

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
                await submitRecord(true);
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
