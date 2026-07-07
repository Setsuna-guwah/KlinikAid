# RAG Content Guidelines
*Recommended structures, chunk partitioning, and formatting standards for the KlinikAid grounding knowledge base*

To maintain highly accurate vector similarity retrieval from Gemini's embeddings without encountering context fragmentation or dilution, documents uploaded via `/admin/rag` must be uploaded as short, topic-coherent chunks.

---

## The Chunking Core Problem
The system segments uploads using character slicing (`1000` character bounds, `200` overlap). If you upload a single long file containing clinic overview, services, hours, and FAQs combined, the slicing boundary will fall mid-sentence or mid-list. 

This results in:
- Context fragmentation (e.g., service listings getting separated from the clinic introduction).
- Low similarity scores because the embedding vectors represent multiple unrelated topics, diluting the focus.

---

## Recommended Upload Partitioning
Instead of uploading one large file, upload **four separate focused documents** through the Admin RAG panel:

### 1. Overview & Contact Info
- **Recommended Title**: `Clinic Overview and Contact Information`
- **Focus**: Clinic description, accreditations, phone, email, address, and tagline.
- **Example Content**:
  ```text
  Blood Care Clinical Laboratory is an accredited medical clinic and clinical laboratory focused on providing high-quality, timely, and value-for-money healthcare. The clinic has been accredited by the Department of Health (DOH) and the Food and Drug Administration (FDA) since 2014.
  Tagline: Health Care Solutions - Our Best Services for a Healthy Life.
  Contact Info:
  - Phone: 8997-2265
  - Email: bloodcare_lab@yahoo.com
  - Facebook: BLOODCARECLINICALLABORATORY
  Address: Conistra Building, A. Mabini St. corner Montania Village, Burgos 1860, Rodriguez, Philippines.
  ```

### 2. Available Services
- **Recommended Title**: `List of Available Clinic Services`
- **Focus**: A clean, unambiguous listing of all medical procedures provided.
- **Example Content**:
  ```text
  Blood Care Clinical Laboratory provides the following medical and diagnostic services:
  - Consultation
  - Laboratory Testing
  - X-Ray
  - Drug Test (DOH-accredited Drug Testing Laboratory)
  - ECG (Electrocardiogram)
  - 2D Echo
  - Vaccination (Adult and Pediatric)
  - Medical Certificate
  - Health Certificate
  ```

### 3. Operating Hours & Schedule
- **Recommended Title**: `Clinic Operating Hours and Schedule`
- **Focus**: Explicit schedule details so hours retrieval scores highly.
- **Example Content**:
  ```text
  Blood Care Clinical Laboratory operating hours are as follows:
  - Monday: 9:00 AM to 5:00 PM
  - Tuesday: 9:00 AM to 5:00 PM
  - Wednesday: 9:00 AM to 5:00 PM
  - Thursday: 9:00 AM to 5:00 PM
  - Friday: 9:00 AM to 5:00 PM
  Note: The clinic is closed on Saturdays, Sundays, and official national holidays.
  ```

### 4. General FAQs & Accreditations
- **Recommended Title**: `Frequently Asked Questions and Accreditations`
- **Focus**: Explicit Q&A patterns covering drug tests, vaccinations, certificates, and FDA credentials.
- **Example Content**:
  ```text
  Frequently Asked Questions (FAQs):
  - Does the clinic do drug testing? Yes, the clinic operates a DOH-accredited drug testing laboratory.
  - Can I get medical certificates? Yes, the clinic issues medical and health certificates.
  - Are vaccinations available? Yes, the clinic provides adult and pediatric vaccinations.
  - Is the clinic accredited? Yes, accredited by both the DOH and FDA since 2014.
  ```

---

## Formatting Guidelines
1. **Explicit Titles**: Use highly descriptive titles. The search context injects `Source: {title}` alongside the matched chunk, providing context.
2. **Clear Headers**: Keep lists formatted using simple bullet points (`-` or `*`). Avoid complex multi-level nested tables.
3. **No Fluff**: Keep sentences short and clear. This increases search similarity hits.
