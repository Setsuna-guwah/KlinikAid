export interface TemplateField {
  key: string;
  label: string;
  type: "text" | "date" | "textarea" | "select";
  required: boolean;
  options?: string[];
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
}

export const CLINIC_TEMPLATES: DocumentTemplate[] = [
  {
    id: "referral-form",
    name: "Referral Form",
    description: "Submit doctor recommendations and requests for clinic services.",
    fields: [
      { key: "referring_physician", label: "Referring Physician", type: "text", required: true },
      { key: "referring_clinic", label: "Referring Clinic / Hospital", type: "text", required: false },
      { key: "reason_for_referral", label: "Reason for Referral", type: "textarea", required: true },
      { key: "requested_service", label: "Requested Service", type: "select", required: true, options: ["Laboratory", "Imaging", "Ultrasound", "ECG"] },
      { key: "referral_date", label: "Referral Date", type: "date", required: true }
    ]
  },
  {
    id: "lab-request",
    name: "Laboratory Request",
    description: "Submit request forms for specific blood and urine diagnostic tests.",
    fields: [
      { key: "ordering_physician", label: "Ordering Physician", type: "text", required: true },
      { key: "tests_requested", label: "Tests Requested", type: "textarea", required: true },
      { key: "fasting_required", label: "Fasting Required?", type: "select", required: false, options: ["Yes", "No"] },
      { key: "request_date", label: "Request Date", type: "date", required: true }
    ]
  },
  {
    id: "med-cert",
    name: "Medical Certificate Request",
    description: "Request official health certifications for school or work clearances.",
    fields: [
      { key: "purpose", label: "Purpose of Certificate", type: "textarea", required: true },
      { key: "date_needed", label: "Date Needed", type: "date", required: true }
    ]
  },
  {
    id: "procedure-consent",
    name: "Consent Form",
    description: "Acknowledge and consent to clinical laboratory diagnostic operations.",
    fields: [
      { key: "procedure", label: "Clinical Procedure", type: "text", required: true },
      { key: "consent_given", label: "I Give My Consent?", type: "select", required: true, options: ["Yes", "No"] },
      { key: "consent_date", label: "Date of Consent", type: "date", required: true }
    ]
  },
  {
    id: "patient-intake",
    name: "Patient Intake Form",
    description: "Submit basic demographics and complaints before visiting the clinic.",
    fields: [
      // patient_name, date_of_birth, contact_number, address are server-injected from profile (#41)
      { key: "chief_complaint", label: "Chief Health Complaint", type: "textarea", required: true }
    ]
  },
  {
    id: "results-release",
    name: "Results Release Authorization",
    description: "Authorize third-party release or sharing of diagnostic lab results.",
    fields: [
      { key: "release_to", label: "Authorize Release To (Name)", type: "text", required: true },
      { key: "results_type", label: "Clinical Results Authorized for Release", type: "text", required: true },
      { key: "authorization_date", label: "Authorization Date", type: "date", required: true }
    ]
  }
];

