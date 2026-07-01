"use client";

import React, { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, Thermometer, Weight, Activity } from "lucide-react";

const triageSchema = z.object({
  department: z.enum(["laboratory", "imaging", "ultrasound", "ecg"], {
    message: "Please select a department",
  }),
  blood_pressure: z
    .string()
    .optional()
    .refine((val) => !val || /^\d{2,3}\/\d{2,3}$/.test(val), {
      message: "Format must be e.g. 120/80",
    }),
  weight_kg: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) > 0 && parseFloat(val) < 500), {
      message: "Must be a valid positive weight",
    }),
  temperature_c: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) >= 30 && parseFloat(val) <= 45), {
      message: "Temperature must be between 30°C and 45°C",
    }),
  notes: z.string().optional(),
});

type TriageFormValues = z.infer<typeof triageSchema>;

interface TriageModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  documentId: string;
}

export default function TriageModal({
  isOpen,
  onClose,
  patientId,
  patientName,
  documentId,
}: TriageModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showVitals, setShowVitals] = useState(false);
  const [previewQueueNo, setPreviewQueueNo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<TriageFormValues>({
    resolver: zodResolver(triageSchema),
    defaultValues: {
      blood_pressure: "",
      weight_kg: "",
      temperature_c: "",
      notes: "",
    },
  });

  const selectedDept = watch("department");

  // Fetch queue preview when department is selected
  React.useEffect(() => {
    if (!selectedDept) {
      setPreviewQueueNo(null);
      return;
    }
    
    const deptCodes: Record<string, string> = {
      laboratory: "LAB",
      imaging: "IMG",
      ultrasound: "ULT",
      ecg: "ECG",
    };
    setPreviewQueueNo(`${deptCodes[selectedDept]}-00+`);
  }, [selectedDept]);

  const onSubmit = (values: TriageFormValues) => {
    startTransition(async () => {
      try {
        // 1. If a documentId is provided, approve the document first
        if (documentId) {
          const approveResponse = await fetch(`/api/reception/documents/${documentId}/approve`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              notes: values.notes || "",
              destination_department: values.department,
            }),
          });

          const approveResult = await approveResponse.json();
          if (!approveResponse.ok || !approveResult.success) {
            throw new Error(approveResult.message || "Failed to approve the document before triage");
          }
        }

        // 2. Call triage route to assign patient to queue
        const response = await fetch("/api/reception/triage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            patient_id: patientId,
            department: values.department,
            notes: values.notes,
            vitals: {
              blood_pressure: values.blood_pressure || null,
              weight_kg: values.weight_kg || null,
              temperature_c: values.temperature_c || null,
            },
          }),
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || "Failed to complete triage");
        }

        toast.success(`Document approved and patient routed to ${values.department} — Queue #${result.data.queue_number}`);
        reset();
        onClose();
        router.push("/reception/queue");
        router.refresh();
      } catch (error) {
        const err = error as Error;
        toast.error(err.message || "An unexpected error occurred");
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px] border border-slate-200/80 dark:border-slate-800 shadow-xl bg-white dark:bg-slate-950">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900 dark:text-white">
            Triage & Department Routing
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500 dark:text-slate-400">
            Route {patientName} to a diagnostic department and record vitals.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          {/* Patient Info (Read-Only) */}
          <div className="grid gap-2">
            <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient Name</Label>
            <Input value={patientName} disabled className="bg-slate-50 dark:bg-slate-900/50 cursor-not-allowed border-slate-200" />
          </div>

          <div className="grid gap-4">
            {/* Department Selector */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="department" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Select Department
              </Label>
              <Select
                onValueChange={(val) => {
                  if (val) setValue("department", val as "laboratory" | "imaging" | "ultrasound" | "ecg", { shouldValidate: true });
                }}
                value={selectedDept}
              >
                <SelectTrigger id="department" className="border-slate-200 dark:border-slate-800">
                  <SelectValue placeholder="Choose department" />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <SelectItem value="laboratory">Laboratory</SelectItem>
                  <SelectItem value="imaging">Imaging (X-Ray)</SelectItem>
                  <SelectItem value="ultrasound">Ultrasound</SelectItem>
                  <SelectItem value="ecg">ECG</SelectItem>
                </SelectContent>
              </Select>
              {errors.department && (
                <p className="text-xs text-red-500">{errors.department.message}</p>
              )}
            </div>
          </div>

          {/* Queue Preview (Dynamic) */}
          {selectedDept && (
            <div className="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200/50 dark:border-slate-800/50 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase">Estimated Queue No</span>
              <span className="text-sm font-bold text-accentBlue-600 dark:text-accentBlue-400 bg-accentBlue-50 dark:bg-accentBlue-950/40 px-2 py-0.5 rounded">
                {previewQueueNo}
              </span>
            </div>
          )}

          {/* Vitals Section (Collapsible) */}
          <div className="border border-slate-200/60 dark:border-slate-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowVitals(!showVitals)}
              className="w-full flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/20 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
            >
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-emerald-500" />
                Vitals (Optional)
              </span>
              {showVitals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showVitals && (
              <div className="p-4 bg-white dark:bg-slate-950 border-t border-slate-200/50 dark:border-slate-800/50 grid grid-cols-3 gap-3">
                {/* BP */}
                <div className="space-y-1">
                  <Label htmlFor="blood_pressure" className="text-xs font-medium text-slate-500">Blood Press.</Label>
                  <Input
                    id="blood_pressure"
                    placeholder="e.g. 120/80"
                    {...register("blood_pressure")}
                    className="border-slate-200 dark:border-slate-800 h-9 text-xs"
                  />
                  {errors.blood_pressure && (
                    <p className="text-[10px] text-red-500">{errors.blood_pressure.message}</p>
                  )}
                </div>

                {/* Weight */}
                <div className="space-y-1">
                  <Label htmlFor="weight_kg" className="text-xs font-medium text-slate-500 flex items-center gap-0.5">
                    <Weight className="h-3 w-3 text-slate-400" />
                    Weight (kg)
                  </Label>
                  <Input
                    id="weight_kg"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 70"
                    {...register("weight_kg")}
                    className="border-slate-200 dark:border-slate-800 h-9 text-xs"
                  />
                  {errors.weight_kg && (
                    <p className="text-[10px] text-red-500">{errors.weight_kg.message}</p>
                  )}
                </div>

                {/* Temp */}
                <div className="space-y-1">
                  <Label htmlFor="temperature_c" className="text-xs font-medium text-slate-500 flex items-center gap-0.5">
                    <Thermometer className="h-3 w-3 text-slate-400" />
                    Temp (°C)
                  </Label>
                  <Input
                    id="temperature_c"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 36.5"
                    {...register("temperature_c")}
                    className="border-slate-200 dark:border-slate-800 h-9 text-xs"
                  />
                  {errors.temperature_c && (
                    <p className="text-[10px] text-red-500">{errors.temperature_c.message}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="grid gap-2">
            <Label htmlFor="notes" className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Triage Notes / Symptoms
            </Label>
            <Textarea
              id="notes"
              placeholder="Add symptoms, referral details or check-in notes..."
              {...register("notes")}
              rows={3}
              className="border-slate-200 dark:border-slate-800 text-xs"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-200/50 dark:border-slate-800/50">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="border-slate-200 hover:bg-slate-100 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-md shadow-emerald-500/10 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Routing...
                </>
              ) : (
                "Confirm Routing"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
