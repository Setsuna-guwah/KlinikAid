"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import DataLoadError from "@/components/DataLoadError";
import { toast } from "sonner";
import { formatPhTimeFull } from "@/lib/utils";
import {
  Upload,
  Plus,
  Trash2,
  Search,
  Loader2,
  Brain,
  Sparkles,
  FileText,
  X,
} from "lucide-react";
import {
  uploadRagTextAction,
  uploadRagPdfAction,
  deleteRagDocumentAction,
} from "@/app/(dashboard)/admin/rag/actions";

interface GroupedDocument {
  documentId: string;
  title: string;
  sourceType: "text" | "pdf";
  chunkCount: number;
  totalLength: number;
  createdAt: string;
}

interface RagManagerClientProps {
  initialDocuments: GroupedDocument[];
  /** Set when the initial fetch failed. An empty list is then not "no documents". */
  error?: { message: string } | null;
}

export default function RagManagerClient({ initialDocuments, error = null }: RagManagerClientProps) {
  const [documents, setDocuments] = useState<GroupedDocument[]>(initialDocuments);
  const [searchTerm, setSearchTerm] = useState("");

  React.useEffect(() => {
    setDocuments(initialDocuments);
  }, [initialDocuments]);
  
  // Dialog Open States
  const [isTextDialogOpen, setIsTextDialogOpen] = useState(false);
  const [isPdfDialogOpen, setIsPdfDialogOpen] = useState(false);
  const [deleteDoc, setDeleteDoc] = useState<GroupedDocument | null>(null);

  // Form Inputs
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Transitions for Server Actions
  const [isUploadingText, startUploadText] = useTransition();
  const [isUploadingPdf, startUploadPdf] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const router = useRouter();

  // Search Filter
  const filteredDocuments = documents.filter((doc) =>
    doc.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // When the initial load failed, `documents` is empty for a reason that has
  // nothing to do with whether documents exist. Rendering the normal empty
  // state here would tell an operator the knowledge base is empty when it may
  // hold every clinical guideline the chatbot grounds its answers on.
  if (error && filteredDocuments.length === 0) {
    return (
      <div className="space-y-6">
        <DataLoadError
          what="the knowledge base"
          error={error}
          retryHref="/admin/rag"
        />
      </div>
    );
  }

  const handleUploadText = () => {
    if (!textTitle.trim() || !textContent.trim()) {
      toast.error("Title and content are required.");
      return;
    }

    startUploadText(async () => {
      const result = await uploadRagTextAction(textTitle, textContent);
      if (result.success) {
        toast.success("Document uploaded and indexed successfully!");
        setIsTextDialogOpen(false);
        setTextTitle("");
        setTextContent("");
        router.refresh();
      } else {
        toast.error(result.error || "Failed to upload document.");
      }
    });
  };

  const handleUploadPdf = (e: React.FormEvent) => {
    e.preventDefault();
    const file = pdfFile; // capture snapshot
    if (!file) {
      toast.error("Please select a PDF file.");
      return;
    }

    // Client-side 10MB limit check
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds the 10MB limit.");
      return;
    }

    startUploadPdf(async () => {
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadRagPdfAction(formData);
      if (result.success) {
        toast.success("PDF extracted, chunked, and indexed successfully!");
        setIsPdfDialogOpen(false);
        setPdfFile(null);
        router.refresh();
      } else {
        toast.error(result.error || "Failed to process PDF.");
      }
    });
  };

  const handleDelete = () => {
    if (!deleteDoc) return;

    startDelete(async () => {
      const result = await deleteRagDocumentAction(deleteDoc.documentId);
      if (result.success) {
        toast.success(`Deleted document "${deleteDoc.title}"`);
        setDocuments(documents.filter((d) => d.documentId !== deleteDoc.documentId));
        setDeleteDoc(null);
      } else {
        toast.error(result.error || "Failed to delete document.");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Controls & Search bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search knowledge documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-10 border-slate-200 dark:border-slate-800"
          />
        </div>
        
        <div className="flex w-full md:w-auto gap-3">
          <Button
            onClick={() => setIsTextDialogOpen(true)}
            className="flex-1 md:flex-none gap-2 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-50 dark:hover:bg-slate-100 dark:text-slate-900"
          >
            <Plus className="h-4 w-4" />
            Add Plain Text
          </Button>
          
          <Button
            onClick={() => setIsPdfDialogOpen(true)}
            className="flex-1 md:flex-none gap-2 bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700"
          >
            <Upload className="h-4 w-4" />
            Upload PDF
          </Button>
        </div>
      </div>

      {/* Main List */}
      <Card className="border-slate-200/80 dark:border-slate-800/80 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
              <TableRow>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-400 pl-6 py-4">Document Title</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-400">Type</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-400">Total Chunks</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-400">Character Count</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-400">Indexed Date</TableHead>
                <TableHead className="font-semibold text-slate-600 dark:text-slate-400 text-right pr-6">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-slate-500 dark:text-slate-400">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <Brain className="h-10 w-10 text-slate-300 dark:text-slate-700 stroke-[1.5]" />
                      <span className="font-medium">No RAG documents indexed yet.</span>
                      <span className="text-xs text-slate-400">Add plain text or upload a PDF to ground your AI assistant.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredDocuments.map((doc) => (
                  <TableRow key={doc.documentId} className="hover:bg-slate-50/30 dark:hover:bg-slate-800/10">
                    <TableCell className="font-medium text-slate-900 dark:text-white pl-6 py-4 truncate max-w-xs">
                      {doc.title}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          doc.sourceType === "pdf"
                            ? "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30"
                            : "bg-accentBlue-50 text-accentBlue-700 border-accentBlue-100 dark:bg-accentBlue-950/20 dark:text-accentBlue-400 dark:border-accentBlue-900/30"
                        }
                      >
                        {doc.sourceType.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-700 dark:text-slate-300">
                      {doc.chunkCount}
                    </TableCell>
                    <TableCell className="text-slate-700 dark:text-slate-300">
                      {doc.totalLength.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400 text-xs">
                      {formatPhTimeFull(doc.createdAt)}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteDoc(doc)}
                        className="text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* dialog 1: Add Plain Text */}
      <Dialog open={isTextDialogOpen} onOpenChange={(open) => !isUploadingText && setIsTextDialogOpen(open)}>
        <DialogContent className="sm:max-w-[600px] border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-teal-700 dark:text-teal-500" />
              Index Plain Text Document
            </DialogTitle>
            <DialogDescription>
              Write or paste guidelines, policies, or QA lists. The text will be chunked and converted into vector embeddings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Document Title</Label>
              <Input
                id="title"
                placeholder="e.g. Clinic Schedules & Address"
                value={textTitle}
                onChange={(e) => setTextTitle(e.target.value)}
                disabled={isUploadingText}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <Textarea
                id="content"
                placeholder="Paste document text here..."
                rows={10}
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                disabled={isUploadingText}
                className="font-sans resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTextDialogOpen(false)} disabled={isUploadingText}>
              Cancel
            </Button>
            <Button onClick={handleUploadText} disabled={isUploadingText} className="gap-2 bg-teal-700 hover:bg-teal-800 text-white">
              {isUploadingText ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Vectors...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Process & Index
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog 2: Upload PDF */}
      <Dialog open={isPdfDialogOpen} onOpenChange={(open) => !isUploadingPdf && setIsPdfDialogOpen(open)}>
        <DialogContent className="sm:max-w-[500px] border-slate-200 dark:border-slate-800">
          <form onSubmit={handleUploadPdf}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-teal-700 dark:text-teal-500" />
                Upload & Process PDF
              </DialogTitle>
              <DialogDescription>
                Select a clinical PDF document. Gemini AI will extract all text to create vectorized searchable chunks.
              </DialogDescription>
            </DialogHeader>
            <div className={`py-8 flex flex-col items-center justify-center border-2 border-dashed rounded-xl my-4 transition-all relative ${
              isUploadingPdf
                ? "border-slate-100 bg-slate-50/50 dark:border-slate-800/50 dark:bg-slate-900/20 opacity-60"
                : pdfFile
                ? "border-teal-500 bg-teal-50/5 dark:border-teal-500/50 dark:bg-teal-950/5"
                : "border-slate-200 dark:border-slate-800 hover:border-teal-500/50"
            }`}>
              {isUploadingPdf ? (
                <Loader2 className="h-10 w-10 text-teal-600 dark:text-teal-400 animate-spin mb-3" />
              ) : pdfFile ? (
                <FileText className="h-10 w-10 text-teal-600 dark:text-teal-400 mb-3" />
              ) : (
                <Upload className="h-10 w-10 text-slate-400 mb-3" />
              )}
              
              <input
                id="pdf-file-input"
                name="file"
                type="file"
                accept=".pdf"
                className="hidden"
                disabled={isUploadingPdf}
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              />
              
              {pdfFile ? (
                <div className="flex flex-col items-center space-y-1">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 px-4 text-center break-all">
                    {pdfFile.name}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {(pdfFile.size / (1024 * 1024)).toFixed(2)} MB
                  </span>
                  {!isUploadingPdf && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setPdfFile(null);
                        const fileInput = document.getElementById("pdf-file-input") as HTMLInputElement;
                        if (fileInput) fileInput.value = "";
                      }}
                      className="mt-2 text-xs text-red-600 hover:text-red-500 flex items-center gap-1 font-medium py-1 px-2 rounded-md hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Remove file
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <Label
                    htmlFor="pdf-file-input"
                    className="cursor-pointer font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                  >
                    Select a PDF file
                  </Label>
                  <span className="text-[10px] text-slate-400 mt-1">Maximum file size 10MB</span>
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsPdfDialogOpen(false)} disabled={isUploadingPdf}>
                Cancel
              </Button>
              <Button type="submit" disabled={isUploadingPdf || !pdfFile} className="gap-2 bg-teal-700 hover:bg-teal-800 text-white">
                {isUploadingPdf ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gemini Parsing & Chunking...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Extract & Index
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* dialog 3: Delete Confirm */}
      <Dialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <DialogContent className="sm:max-w-[400px] border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle>Delete Knowledge Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-semibold text-slate-900 dark:text-white">&ldquo;{deleteDoc?.title}&rdquo;</span>? This will permanently remove all {deleteDoc?.chunkCount} related chunks from the vector database and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteDoc(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="gap-2">
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Permanently"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
