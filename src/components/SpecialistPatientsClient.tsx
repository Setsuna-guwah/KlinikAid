"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { 
  Search, 
  Calendar, 
  Layers, 
  ArrowRight, 
  Activity,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertTriangle
} from "lucide-react";
import { getAge, formatPhTime as formatPhDate } from "@/lib/utils";
import { fetchJson, type ApiError } from "@/lib/fetch-json";
import { isLocallySearchable, rosterMatchesText } from "@/lib/specialist-roster-search";
import DataLoadError from "@/components/DataLoadError";
import { useHydrated } from "@/lib/use-hydrated";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PatientData {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  contact_number: string | null;
  email: string | null;
  address: string | null;
  patient_code: string;
  total_records: number;
  flagged_count: number;
  last_test_date: string | null;
}

interface RosterPage {
  patients: PatientData[];
  /** Uncapped count of patients matching the search terms. */
  matchCount: number;
  /** True when `matchCount` exceeds what was returned. */
  truncated: boolean;
  limit: number;
}

interface SpecialistPatientsClientProps {
  initialPatients: PatientData[];
  /** Total patients on file, or null when the count could not be read. */
  rosterTotal: number | null;
  /** Maximum rows the server will return in one response. */
  rosterLimit: number;
}

import { 
  Plus,
  Archive,
  Lock
} from "lucide-react";
import { toast } from "sonner";
import { createSpecialistPatientAction, deleteSpecialistPatientAction } from "@/app/(dashboard)/specialist/patients/actions";
import { ADDRESS_MAX } from "@/lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { focusRingClass } from "@/lib/focus-ring";

/**
 * The specialist's own patient roster: the filter card, the directory table
 * and the add/archive dialogs.
 *
 * The roster arrives from the server already read, so the first paint shows
 * the directory the specialist is entitled to. A search that fails is
 * reported as a failure rather than as an empty list, because an empty list
 * reads as "no patient matches", and that is a claim about the data.
 */
export default function SpecialistPatientsClient({
  initialPatients,
  rosterTotal,
  rosterLimit,
}: SpecialistPatientsClientProps) {
  const [patients, setPatients] = useState<PatientData[]>(initialPatients);
  // The whole roster, when the page loaded all of it: a text search can then be
  // answered here instead of by a request. Null whenever the roster is not known
  // to be complete, which includes after a create or an archive until the next
  // unfiltered load confirms it again.
  const fullRoster = useRef<PatientData[] | null>(
    rosterTotal !== null && rosterTotal <= initialPatients.length ? initialPatients : null,
  );
  // The request in flight. A newer search aborts it, so a slow older response
  // cannot land after the answer to the query on screen.
  const requestAbort = useRef<AbortController | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const isFirstMount = useRef(true);

  // Whether the list below is the unfiltered directory or the result of a
  // search. A search that fails must not leave the directory on screen while the
  // filter inputs still show the query that was typed: the specialist then reads
  // a patient's record as being in scope when the roster was never filtered.
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  // What the server said this list actually covers, as opposed to how many rows
  // came back. Null until a search has reported it.
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const hydrated = useHydrated();

  // Specialist Modal & Action States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSavingPatient, setIsSavingPatient] = useState(false);
  const [archivingPatientIds, setArchivingPatientIds] = useState<Set<string>>(new Set());
  // The patient the confirmation dialog is about. Kept after the dialog closes so
  // the name does not blank out during its exit animation; it is replaced on the
  // next archive attempt.
  const [archiveTarget, setArchiveTarget] = useState<PatientData | null>(null);
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const fetchFilteredPatients = useCallback(async (
    query: string, 
    dept: string, 
    start: string, 
    end: string
  ) => {
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    setLoading(true);
    setSearchError(null);

    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (dept) params.set("department", dept);
    if (start) params.set("startDate", start);
    if (end) params.set("endDate", end);

    const outcome = await fetchJson<RosterPage>(`/api/specialist/patients?${params.toString()}`, {
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    setLoading(false);
    setCurrentPage(1); // reset to page 1 on new search

    if (outcome.kind === "failed") {
      // Empty the list rather than leaving the previous result set visible. A
      // failed search showing the old rows is indistinguishable from a search
      // that matched, which is how the wrong patient's record gets read.
      setPatients([]);
      setMatchCount(null);
      setTruncated(false);
      setSearchError(outcome.error);
      return;
    }

    setPatients(outcome.data?.patients ?? []);
    setMatchCount(outcome.data?.matchCount ?? null);
    setTruncated(Boolean(outcome.data?.truncated));

    // An unfiltered load that was not cut off is the whole roster again.
    if (!query && !dept && !start && !end && outcome.data && !outcome.data.truncated) {
      fullRoster.current = outcome.data.patients;
    }
  }, []);

  const handleCreatePatient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSavingPatient(true);
    const formData = new FormData(e.currentTarget);
    try {
      const res = await createSpecialistPatientAction(null, formData);
      if (res.success) {
        toast.success("Private patient created successfully!");
        setIsModalOpen(false);
        // Refresh the list
        fullRoster.current = null;
        fetchFilteredPatients(searchQuery, deptFilter, startDate, endDate);
      } else {
        toast.error(res.error || "Failed to create patient");
      }
    } catch {
      toast.error("An error occurred");
    } finally {
      setIsSavingPatient(false);
    }
  };

  const handleArchivePatient = (patient: PatientData) => {
    setArchiveTarget(patient);
    setIsArchiveDialogOpen(true);
  };

  const confirmArchivePatient = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    setIsArchiveDialogOpen(false);
    setArchivingPatientIds((ids) => new Set(ids).add(target.id));
    try {
      const res = await deleteSpecialistPatientAction(target.id);
      if (res.success) {
        // The action archives rather than destroys: the patient and their records
        // stay in the database with deleted_at set, and the roster stops listing them.
        toast.success("Patient archived.");
        fullRoster.current = null;
        fetchFilteredPatients(searchQuery, deptFilter, startDate, endDate);
      } else {
        toast.error(res.error || "Failed to archive patient");
      }
    } catch {
      toast.error("Failed to archive patient");
    } finally {
      setArchivingPatientIds((ids) => {
        const next = new Set(ids);
        next.delete(target.id);
        return next;
      });
    }
  };

  // Trigger search on parameter updates. A text search over a complete roster is
  // answered from the roster at once. Anything else goes to the server, debounced,
  // and the loading row shows straight away rather than after the debounce.
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    // Cancel whatever is in flight here, not when the debounce fires. A response
    // to the previous filters can otherwise land inside the 250 ms window: it
    // prints rows that answer the old filters and clears the loading state while
    // the inputs already show the new ones.
    requestAbort.current?.abort();

    const query = searchQuery.trim();
    const roster = fullRoster.current;
    if (roster && !deptFilter && !startDate && !endDate && isLocallySearchable(query)) {
      const matches = roster.filter((patient) => rosterMatchesText(patient, query));
      setLoading(false);
      setSearchError(null);
      setCurrentPage(1);
      setPatients(matches);
      setMatchCount(matches.length);
      setTruncated(false);
      return;
    }

    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      fetchFilteredPatients(searchQuery, deptFilter, startDate, endDate);
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, deptFilter, startDate, endDate, fetchFilteredPatients]);

  // Another window can create or archive a patient while this one is open, and
  // the cached roster would then answer a plain-name search from a list that no
  // longer matches the server: the new patient missing, the archived one still
  // listed. Coming back to this window drops the cache, so that search goes to
  // the server instead. A focus without a preceding blur says nothing about the
  // roster -- some browsers fire one on load -- so only a return counts.
  useEffect(() => {
    let leftWindow = false;
    const onBlur = () => {
      leftWindow = true;
    };
    const onFocus = () => {
      if (!leftWindow) return;
      leftWindow = false;
      fullRoster.current = null;
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const handleReset = () => {
    setSearchQuery("");
    setDeptFilter("");
    setStartDate("");
    setEndDate("");
  };

  // Pagination Math
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = patients.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(patients.length / itemsPerPage);

  // Whether the visible list is a filtered result or the whole directory.
  // Derived rather than stored so it cannot drift out of step with the inputs.
  const hasActiveFilter = Boolean(
    searchQuery.trim() || deptFilter.trim() || startDate.trim() || endDate.trim()
  );

  // The honest size of what is on screen. This is never the row count: the
  // server caps the roster, so `patients.length` is an upper bound and reporting
  // it as "of N patients" tells a specialist their patient list ends at 100 when
  // it does not.
  const visibleTotal = hasActiveFilter ? matchCount : rosterTotal;
  const isTruncated = hasActiveFilter ? truncated : (rosterTotal ?? 0) > patients.length;

  // Philippine date formatter is imported from @/lib/utils

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-indigo-900 dark:from-white dark:to-indigo-300 bg-clip-text text-transparent flex items-center gap-2">
            <Lock className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            Private Patient Directory
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Secure, isolated directory of your private patient roster. Invisible to administrators.
          </p>
        </div>
        <div>
          <Button 
            onClick={() => setIsModalOpen(true)}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Private Patient
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm bg-slate-50/20 dark:bg-slate-900/5">
        <CardContent className="p-4 sm:p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-12">
            {/* Search Input */}
            <div className="md:col-span-5 relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500 dark:text-slate-400" />
              <input
                type="text"
                placeholder="Search patient name or code (e.g. PT-123456)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 placeholder-slate-400 outline-none focus:ring-3 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            {/* Department Filter */}
            <div className="md:col-span-3 relative">
              <Layers className="absolute left-3 top-3 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 outline-none focus:ring-3 focus:ring-indigo-500 focus:border-indigo-500 appearance-none"
              >
                <option value="">All Departments</option>
                <option value="laboratory">Laboratory</option>
                <option value="imaging">Imaging</option>
                <option value="ultrasound">Ultrasound</option>
                <option value="ecg">ECG</option>
              </select>
            </div>

            {/*
              Date Filters.

              A native date control refuses to be narrower than 165px (its
              min-content width), so two of them side by side need 338px. The
              four column slot below `lg` cannot give them that, and the
              overflow was cut off by the card's `overflow-hidden` - the end
              date field and the right side of its focus ring with it (issue
              #190).

              The range therefore wraps: `flex-wrap` puts the two fields on
              their own rows when the slot is too narrow, and each field keeps
              `min-w-[11rem]` (176px) so the date text and the picker button
              never collide. Below `lg` the block takes a full row, because
              the twelve column grid is then too narrow even for one field.
            */}
            <div className="md:col-span-12 lg:col-span-4 flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[11rem]">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  placeholder="Start Date"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 outline-none focus:ring-3 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="relative flex-1 min-w-[11rem]">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-500 dark:text-slate-400 pointer-events-none" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  placeholder="End Date"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 outline-none focus:ring-3 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Reset Action */}
          {(searchQuery || deptFilter || startDate || endDate) && (
            <div className="flex justify-end pt-1">
              <button
                onClick={handleReset}
                className={`text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition ${focusRingClass}`}
              >
                Clear all filters
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Directory Results */}
      <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 font-semibold border-y border-slate-100 dark:border-slate-800">
                  <th className="p-4">Code</th>
                  <th className="p-4">Patient Name</th>
                  <th className="p-4">Demographics</th>
                  <th className="p-4 text-center">Total Records</th>
                  <th className="p-4 text-center">Flagged Status</th>
                  <th className="p-4">Last Tested</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-500 dark:text-slate-400">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin text-indigo-500" />
                        <span>Searching directory database...</span>
                      </div>
                    </td>
                  </tr>
                ) : searchError ? (
                  <tr>
                    <td colSpan={7} className="p-6">
                      <DataLoadError what="the patient roster" error={searchError} />
                    </td>
                  </tr>
                ) : currentItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-500 dark:text-slate-400">
                      {hasActiveFilter
                        ? "No patients match search terms or department filters."
                        : "No patients in this directory yet."}
                    </td>
                  </tr>
                ) : (
                  currentItems.map((patient) => (
                    <tr key={patient.id} className="hover:bg-slate-50/30 dark:hover:bg-slate-900/5 transition">
                      <td className="p-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                        {patient.patient_code}
                      </td>
                      <td className="p-4 font-semibold text-slate-800 dark:text-slate-100">
                        {patient.last_name}, {patient.first_name}
                      </td>
                      <td className="p-4 text-slate-500">
                        {hydrated ? getAge(patient.date_of_birth, Date.now()) : ""} yrs • <span className="capitalize">{patient.gender}</span>
                      </td>
                      <td className="p-4 text-center font-medium text-slate-700 dark:text-slate-300">
                        {patient.total_records}
                      </td>
                      <td className="p-4 text-center">
                        {patient.flagged_count > 0 ? (
                          <Badge variant="destructive" className="font-semibold text-[10px] px-2 py-0.5">
                            {patient.flagged_count} Flagged
                          </Badge>
                        ) : patient.total_records > 0 ? (
                          <Badge variant="secondary" className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400 font-semibold text-[10px] px-2 py-0.5 border border-emerald-100 dark:border-emerald-900/10">
                            Clear
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-slate-400">No records</span>
                        )}
                      </td>
                      <td className="p-4 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                        {formatPhDate(patient.last_test_date)}
                      </td>
                      <td className="p-4 pr-6 text-right flex items-center justify-end gap-2">
                        <Link 
                          href={`/specialist/patients/${patient.id}/record-entry`}
                          className="inline-flex items-center gap-1 font-semibold text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-400 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/45 px-2.5 py-1.5 rounded-lg transition"
                        >
                          Enter Record
                        </Link>
                        <Link 
                          href={`/specialist/patients/${patient.id}/analytics`}
                          prefetch
                          className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 bg-indigo-50/50 hover:bg-indigo-100/70 dark:bg-slate-800 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition"
                        >
                          Analytics
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleArchivePatient(patient)}
                          disabled={archivingPatientIds.has(patient.id)}
                          title="Archive patient"
                          aria-label={`Archive ${patient.first_name} ${patient.last_name}`}
                          className="text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 h-8 w-8 transition"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Truncation disclosure. A capped list that does not say it is capped
              is indistinguishable from a complete one, and "of 100 patients"
              reads as the size of the directory. */}
          {isTruncated && !searchError ? (
            <div className="flex items-start gap-2 border-t border-amber-100 dark:border-amber-900/30 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                Showing the first {patients.length} of {visibleTotal}{" "}
                {hasActiveFilter ? "matching" : "patients on file"}. The roster is
                loaded in pages of at most {rosterLimit}, so{" "}
                {hasActiveFilter
                  ? "patients beyond this page cannot be reached by this search."
                  : "patients further down the alphabet are not listed here."}{" "}
                Narrow the search to reach them.
              </p>
            </div>
          ) : null}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-slate-100 dark:border-slate-800 text-xs">
              <p className="text-slate-500">
                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, patients.length)} of {patients.length} loaded
                {visibleTotal !== null && visibleTotal > patients.length
                  ? ` (${visibleTotal} ${hasActiveFilter ? "match" : "on file"} in total)`
                  : ""}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  aria-label="Previous page"
                  className={`p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50 disabled:pointer-events-none transition ${focusRingClass}`}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <span className="flex items-center px-3 font-semibold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {currentPage} / {totalPages}
                </span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  aria-label="Next page"
                  className={`p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50 disabled:pointer-events-none transition ${focusRingClass}`}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Static Disclaimer */}
      <div className="p-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10 text-amber-800 dark:text-amber-300 text-xs leading-relaxed flex gap-2">
        <Activity className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">No AI Diagnostics Inference:</span> This directory provides clinical descriptive analytics only. No machine learning diagnostics or automated diagnostic suggestions are applied to this patient data (SO-C Compliance).
        </div>
      </div>

      {/* Archive confirmation. The action archives: the patient and their records
          stay in the database with deleted_at set, and the roster stops listing
          them. There is no restore UI, so the wording does not promise one. */}
      <AlertDialog
        open={isArchiveDialogOpen}
        onOpenChange={(open) => setIsArchiveDialogOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {archiveTarget?.first_name} {archiveTarget?.last_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be removed from your patient list. Their records are kept
              and are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep patient</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmArchivePatient}>
              Archive patient
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Patient Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-slate-950">
          <form onSubmit={handleCreatePatient}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900 dark:text-white">
                Add Private Patient
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                Create a patient record visible exclusively to your specialist account.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="firstName" className="text-xs">First Name *</Label>
                  <Input id="firstName" name="firstName" required className="text-xs h-9" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lastName" className="text-xs">Last Name *</Label>
                  <Input id="lastName" name="lastName" required className="text-xs h-9" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="dob" className="text-xs">Date of Birth *</Label>
                  <Input id="dob" name="dob" type="date" required className="text-xs h-9" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gender" className="text-xs">Gender *</Label>
                  <select
                    id="gender"
                    name="gender"
                    required
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 outline-none focus:ring-3 focus:ring-indigo-500 h-9"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="contactNumber" className="text-xs">Contact Number</Label>
                <Input id="contactNumber" name="contactNumber" placeholder="e.g. 09171234567" className="text-xs h-9" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="email" className="text-xs">Email Address</Label>
                <Input id="email" name="email" type="email" placeholder="e.g. name@domain.com" className="text-xs h-9" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="address" className="text-xs">Home Address</Label>
                <Input id="address" name="address" placeholder="Street, Barangay, City, Province" maxLength={ADDRESS_MAX} className="text-xs h-9" />
              </div>
            </div>

            <DialogFooter className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="text-xs h-9"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSavingPatient}
                className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs h-9 font-semibold"
              >
                {isSavingPatient ? "Saving..." : "Save Patient"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
