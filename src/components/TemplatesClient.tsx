"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  ClipboardList, 
  ArrowLeft, 
  Send, 
  HelpCircle,
  FileText,
  User
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CLINIC_TEMPLATES, DocumentTemplate } from "@/lib/documentTemplates";
import { submitTemplateDocumentAction } from "@/app/(dashboard)/patient/templates/actions";
import type { PatientIdentityProps } from "@/app/(dashboard)/patient/templates/page";

interface TemplatesClientProps {
  patientIdentity: PatientIdentityProps;
}

export default function TemplatesClient({ patientIdentity }: TemplatesClientProps) {
  const router = useRouter();
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectTemplate = (template: DocumentTemplate) => {
    setSelectedTemplate(template);
    // Reset editable values only (identity is always server-provided)
    const initialValues: Record<string, string> = {};
    template.fields.forEach(f => {
      initialValues[f.key] = "";
    });
    setFormValues(initialValues);
  };

  const handleBackToSelect = () => {
    setSelectedTemplate(null);
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  };

  const isFormValid = () => {
    if (!selectedTemplate) return false;
    return selectedTemplate.fields.every(f => {
      if (!f.required) return true;
      const val = formValues[f.key];
      return val !== undefined && val.trim() !== "";
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;

    if (!isFormValid()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await submitTemplateDocumentAction(
        selectedTemplate.id,
        selectedTemplate.name,
        formValues
      );

      if (res.success) {
        toast.success("Structured form submitted successfully!");
        router.push("/patient/submissions");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to submit form template");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back link when filling form */}
      {selectedTemplate && (
        <div>
          <button 
            type="button"
            onClick={handleBackToSelect}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Template Picker
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-indigo-900 dark:from-white dark:to-indigo-300 bg-clip-text text-transparent flex items-center gap-2">
          <ClipboardList className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
          {selectedTemplate ? selectedTemplate.name : "Document Templates"}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {selectedTemplate 
            ? `Fill out this structured clinic form template. Validation is enforced before submission.`
            : `Select and fill out a pre-formatted clinic form instead of uploading file images.`
          }
        </p>
      </div>

      {/* STEP 1: Template Picker Grid */}
      {!selectedTemplate ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2">
          {CLINIC_TEMPLATES.map(t => (
            <Card 
              key={t.id} 
              onClick={() => handleSelectTemplate(t)}
              className="border border-slate-200/80 dark:border-slate-800 hover:border-indigo-500 hover:shadow-md cursor-pointer transition flex flex-col h-full group bg-slate-50/10 hover:bg-white dark:hover:bg-slate-900/50"
            >
              <CardHeader className="pb-3 flex-grow">
                <div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 group-hover:bg-indigo-600 group-hover:text-white transition duration-200">
                  <FileText className="h-4.5 w-4.5" />
                </div>
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                  {t.name}
                </CardTitle>
                <CardDescription className="text-xs mt-1.5 leading-relaxed">
                  {t.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 pb-4 pr-6 flex justify-end">
                <span className="text-[10px] font-bold text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition flex items-center gap-1">
                  Start Form
                  <Send className="h-3 w-3" />
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* STEP 2: Fillable Form */
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Identity card — server-prefilled, read-only (#41) */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm bg-slate-50/60 dark:bg-slate-900/40">
            <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-slate-400" />
                <CardTitle className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Patient Identity (auto-filled from your profile)
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Full Name</Label>
                <Input value={patientIdentity.fullName || "—"} disabled className="text-xs h-9 bg-white dark:bg-slate-950 cursor-not-allowed opacity-70" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Date of Birth</Label>
                <Input value={patientIdentity.dateOfBirth || "—"} disabled className="text-xs h-9 bg-white dark:bg-slate-950 cursor-not-allowed opacity-70" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Contact Number</Label>
                <Input value={patientIdentity.contactNumber || "—"} disabled className="text-xs h-9 bg-white dark:bg-slate-950 cursor-not-allowed opacity-70" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Address</Label>
                <Input value={patientIdentity.address || "—"} disabled className="text-xs h-9 bg-white dark:bg-slate-950 cursor-not-allowed opacity-70" />
              </div>
            </CardContent>
          </Card>

          {/* Editable template fields */}
          <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-850">
              <CardTitle className="text-sm font-semibold">Structured Input Fields</CardTitle>
              <CardDescription className="text-xs">
                Fill in all details below. Fields marked with an asterisk (*) are required.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              {selectedTemplate.fields.map(field => {
                const val = formValues[field.key] || "";

                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label 
                      htmlFor={`field-${field.key}`} 
                      className="text-xs font-semibold text-slate-700 dark:text-slate-350 flex items-center gap-1"
                    >
                      {field.label}
                      {field.required && <span className="text-red-500">*</span>}
                    </Label>

                    {field.type === "text" && (
                      <Input
                        id={`field-${field.key}`}
                        value={val}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        required={field.required}
                        className="text-xs h-10"
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                      />
                    )}

                    {field.type === "date" && (
                      <Input
                        id={`field-${field.key}`}
                        type="date"
                        value={val}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        required={field.required}
                        className="text-xs h-10"
                      />
                    )}

                    {field.type === "textarea" && (
                      <Textarea
                        id={`field-${field.key}`}
                        value={val}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        required={field.required}
                        className="text-xs min-h-[90px]"
                        placeholder={`Provide detailed details for ${field.label.toLowerCase()}...`}
                      />
                    )}

                    {field.type === "select" && (
                      <select
                        id={`field-${field.key}`}
                        value={val}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                        required={field.required}
                        className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-850 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 h-10 appearance-none"
                      >
                        <option value="">-- Select option --</option>
                        {field.options?.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Form Actions */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleBackToSelect}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !isFormValid()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-2"
            >
              <Send className="h-3.5 w-3.5" />
              {isSubmitting ? "Submitting Form..." : "Submit to Reception"}
            </Button>
          </div>
        </form>
      )}

      {/* Compliance Disclaimer */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/10 text-slate-500 dark:text-slate-400 text-xs leading-relaxed flex gap-2">
        <HelpCircle className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Structured Document Template Module:</span> Submitting a template form will directly route your structured information to the reception desk. There is no need to upload files, run OCR processes, or invoke AI validation triggers for this document.
        </div>
      </div>
    </div>
  );
}
