"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  FileUp, 
  Loader2, 
  ArrowRight,
  Info,
  X
} from "lucide-react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { submitDocumentAction } from "./actions";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];

const formSchema = z.object({
  file: z
    .any()
    .refine((file) => file instanceof File && file.size > 0, {
      message: "Please upload a valid file.",
    })
    .refine((file) => !(file instanceof File) || file.size <= MAX_FILE_SIZE, {
      message: "File size exceeds the 5MB limit.",
    })
    .refine((file) => !(file instanceof File) || ACCEPTED_FILE_TYPES.includes(file.type), {
      message: "Only PDF, JPG, and PNG formats are supported.",
    }),
});

type FormValues = z.infer<typeof formSchema>;

export default function DocumentSubmitClient() {
  const [dragActive, setDragActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { handleSubmit, setValue, formState: { errors }, reset } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setValue("file", file, { shouldValidate: true });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setValue("file", file, { shouldValidate: true });
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setValue("file", undefined as unknown as File, { shouldValidate: false });
    reset();
    setSubmitError(null);
  };

  const onSubmit = async (values: FormValues) => {
    if (!values.file) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const formData = new FormData();
      formData.append("file", values.file);

      const result = await submitDocumentAction(formData);

      if (result.success) {
        setSubmitSuccess(true);
      } else {
        setSubmitError(result.error || "An unexpected error occurred during submission.");
      }
    } catch (err) {
      console.error(err);
      setSubmitError("Failed to connect to the server. Please check your internet connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  if (submitSuccess) {
    return (
      <Card className="border border-emerald-100 dark:border-emerald-950/40 shadow-xl overflow-hidden animate-in fade-in-50 duration-300">
        <div className="bg-emerald-500/10 dark:bg-emerald-950/20 py-8 px-6 text-center border-b border-emerald-100 dark:border-emerald-950/40 flex flex-col items-center justify-center">
          <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/35 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3.5 shadow-sm">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <CardTitle className="text-xl font-bold text-slate-900 dark:text-emerald-400">Document Submitted Successfully</CardTitle>
          <CardDescription className="text-slate-500 dark:text-slate-400 mt-1 max-w-md">
            Your laboratory request has been uploaded and queued for receptionist review.
          </CardDescription>
        </div>
        <CardContent className="p-6 space-y-4">
          <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200/50 dark:border-slate-800 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">File Name:</span>
              <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[250px]">
                {selectedFile?.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">File Size:</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {selectedFile ? formatBytes(selectedFile.size) : "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Status:</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400 border border-yellow-200/40 dark:border-yellow-900/30">
                Pending Review
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Link
              href="/patient/submissions"
              className={cn(
                buttonVariants({ variant: "default" }),
                "flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-colors flex items-center justify-center gap-2 h-10"
              )}
            >
              Track Submission Status <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/patient/dashboard"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "flex-1 border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60 flex items-center justify-center h-10"
              )}
            >
              Return to Dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-slate-200/80 dark:border-slate-800 shadow-md">
      <CardHeader className="flex flex-row items-center gap-4 bg-slate-50/55 dark:bg-slate-900/30 pb-4">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          <Upload className="h-5 w-5" />
        </div>
        <div>
          <CardTitle>File Upload Portal</CardTitle>
          <CardDescription>Upload a digital PDF or image scan (JPG, PNG) of your doctor&apos;s referral script</CardDescription>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Upload your lab request here. It will be sent to the clinic for processing and receptionist review.
          </p>
        </div>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="pt-6 space-y-6">
          {submitError && (
            <Alert variant="destructive" className="bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/50">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Upload Failed</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          {!selectedFile ? (
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all ${
                dragActive
                  ? "border-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/10"
                  : "border-slate-200 hover:border-slate-350 dark:border-slate-800 dark:hover:border-slate-700"
              }`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
            >
              <input
                type="file"
                id="file-upload"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer flex flex-col items-center justify-center space-y-3"
              >
                <div className="p-3 bg-slate-50 dark:bg-slate-900/80 rounded-full border border-slate-200/50 dark:border-slate-800 text-slate-400 hover:text-emerald-500 hover:scale-105 transition-all">
                  <FileUp className="h-8 w-8" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Click to upload or drag & drop
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    PDF, JPEG, or PNG formats only
                  </p>
                </div>
              </label>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200/85 dark:border-slate-850 flex items-center justify-between shadow-sm">
              <div className="flex items-center space-x-3.5 min-w-0">
                <div className="p-2.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-lg">
                  <FileText className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate pr-4">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-slate-400 font-medium">
                    {formatBytes(selectedFile.size)} • {selectedFile.type.split("/")[1]?.toUpperCase() || "Unknown"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={removeFile}
                disabled={isSubmitting}
                className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
          )}

          {errors.file && (
            <p className="text-xs font-semibold text-red-500 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" /> {errors.file.message as string}
            </p>
          )}

          <div className="p-4 bg-slate-50/50 dark:bg-slate-900/20 rounded-lg border border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-3">
            <Info className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-slate-700 dark:text-slate-350">Submission Rules & File Size Restrictions:</p>
              <ul className="list-disc list-inside mt-1 space-y-1 pl-1">
                <li>Documents are immutable once uploaded. Correct errors by deleting pending files and re-uploading.</li>
                <li>Maximum file size is restricted to <strong>5MB</strong> per request.</li>
                <li>Only valid medical/doctor diagnostic requests or referral letters are accepted.</li>
              </ul>
            </div>
          </div>
        </CardContent>

        <CardFooter className="bg-slate-50/20 dark:bg-slate-900/10 p-6 border-t border-slate-100 dark:border-slate-900/60 flex justify-end space-x-3">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting || !selectedFile}
            onClick={removeFile}
            className="border-slate-200 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-900/60"
          >
            Clear
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !selectedFile}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4.5 w-4.5 animate-spin" />
                Submitting lab request...
              </>
            ) : (
              "Submit Lab Request"
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
