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
  RefreshCw
} from "lucide-react";
import { getAge, formatPhTime as formatPhDate } from "@/lib/utils";
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

interface SpecialistPatientsClientProps {
  initialPatients: PatientData[];
}

import { 
  Plus,
  Trash2,
  Lock
} from "lucide-react";
import { toast } from "sonner";
import { createSpecialistPatientAction, deleteSpecialistPatientAction } from "@/app/(dashboard)/specialist/patients/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function SpecialistPatientsClient({
  initialPatients
}: SpecialistPatientsClientProps) {
  const [patients, setPatients] = useState<PatientData[]>(initialPatients);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const isFirstMount = useRef(true);

  // Specialist Modal & Action States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSavingPatient, setIsSavingPatient] = useState(false);
  const [isDeletingPatient, setIsDeletingPatient] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const fetchFilteredPatients = useCallback(async (
    query: string, 
    dept: string, 
    start: string, 
    end: string
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (dept) params.set("department", dept);
      if (start) params.set("startDate", start);
      if (end) params.set("endDate", end);

      const res = await fetch(`/api/specialist/patients?${params.toString()}`);
      const result = await res.json();
      if (result.success) {
        setPatients(result.data);
      }
    } catch (err) {
      console.error("Failed to search patients:", err);
    } finally {
      setLoading(false);
      setCurrentPage(1); // reset to page 1 on new search
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

  const handleDeletePatient = async (id: string) => {
    if (!confirm("Are you sure you want to delete this patient and all their records? This cannot be undone.")) {
      return;
    }
    setIsDeletingPatient(id);
    try {
      const res = await deleteSpecialistPatientAction(id);
      if (res.success) {
        toast.success("Patient record deleted.");
        fetchFilteredPatients(searchQuery, deptFilter, startDate, endDate);
      } else {
        toast.error(res.error || "Failed to delete patient");
      }
    } catch {
      toast.error("Failed to delete patient");
    } finally {
      setIsDeletingPatient(null);
    }
  };

  // Trigger search on parameter updates (debounced query/filter search)
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const delayDebounceFn = setTimeout(() => {
      fetchFilteredPatients(searchQuery, deptFilter, startDate, endDate);
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, deptFilter, startDate, endDate, fetchFilteredPatients]);

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
            className="bg-indigo-600 hover:bg-indigo-750 text-white font-semibold flex items-center gap-2"
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
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-450 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Search patient name or code (e.g. PT-123456)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            {/* Department Filter */}
            <div className="md:col-span-3 relative">
              <Layers className="absolute left-3 top-3 h-4 w-4 text-slate-450 dark:text-slate-500 pointer-events-none" />
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none"
              >
                <option value="">All Departments</option>
                <option value="laboratory">Laboratory</option>
                <option value="imaging">Imaging</option>
                <option value="ultrasound">Ultrasound</option>
                <option value="ecg">ECG</option>
              </select>
            </div>

            {/* Date Filters */}
            <div className="md:col-span-4 flex gap-2">
              <div className="relative flex-1">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-450 dark:text-slate-500 pointer-events-none" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  placeholder="Start Date"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
              <div className="relative flex-1">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-slate-450 dark:text-slate-500 pointer-events-none" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  placeholder="End Date"
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Reset Action */}
          {(searchQuery || deptFilter || startDate || endDate) && (
            <div className="flex justify-end pt-1">
              <button
                onClick={handleReset}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
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
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-semibold border-y border-slate-100 dark:border-slate-850">
                  <th className="p-4">Code</th>
                  <th className="p-4">Patient Name</th>
                  <th className="p-4">Demographics</th>
                  <th className="p-4 text-center">Total Records</th>
                  <th className="p-4 text-center">Flagged Status</th>
                  <th className="p-4">Last Tested</th>
                  <th className="p-4 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400 dark:text-slate-500">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin text-indigo-500" />
                        <span>Searching directory database...</span>
                      </div>
                    </td>
                  </tr>
                ) : currentItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-slate-400 dark:text-slate-550">
                      No patients match search terms or department filters.
                    </td>
                  </tr>
                ) : (
                  currentItems.map((patient) => (
                    <tr key={patient.id} className="hover:bg-slate-50/30 dark:hover:bg-slate-900/5 transition">
                      <td className="p-4 font-mono font-bold text-slate-850 dark:text-slate-200">
                        {patient.patient_code}
                      </td>
                      <td className="p-4 font-semibold text-slate-800 dark:text-slate-100">
                        {patient.last_name}, {patient.first_name}
                      </td>
                      <td className="p-4 text-slate-500">
                        {getAge(patient.date_of_birth)} yrs • <span className="capitalize">{patient.gender}</span>
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
                          <Badge variant="secondary" className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-450 font-semibold text-[10px] px-2 py-0.5 border border-emerald-100 dark:border-emerald-900/10">
                            Clear
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-slate-400">No records</span>
                        )}
                      </td>
                      <td className="p-4 font-mono text-[10px] text-slate-450 dark:text-slate-500">
                        {formatPhDate(patient.last_test_date)}
                      </td>
                      <td className="p-4 pr-6 text-right flex items-center justify-end gap-2">
                        <Link 
                          href={`/specialist/patients/${patient.id}/record-entry`}
                          className="inline-flex items-center gap-1 font-semibold text-emerald-650 hover:text-emerald-850 dark:text-emerald-400 dark:hover:text-emerald-350 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/45 px-2.5 py-1.5 rounded-lg transition"
                        >
                          Enter Record
                        </Link>
                        <Link 
                          href={`/specialist/patients/${patient.id}/analytics`}
                          className="inline-flex items-center gap-1 font-semibold text-indigo-650 hover:text-indigo-850 dark:text-indigo-400 dark:hover:text-indigo-300 bg-indigo-50/50 hover:bg-indigo-100/70 dark:bg-slate-800 dark:hover:bg-slate-750 px-2.5 py-1.5 rounded-lg transition"
                        >
                          Analytics
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeletePatient(patient.id)}
                          disabled={isDeletingPatient === patient.id}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20 h-8 w-8 transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-slate-100 dark:border-slate-850 text-xs">
              <p className="text-slate-500">
                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, patients.length)} of {patients.length} patients
              </p>
              <div className="flex gap-2">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  className="p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-650 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50 disabled:pointer-events-none transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="flex items-center px-3 font-semibold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {currentPage} / {totalPages}
                </span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  className="p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-650 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50 disabled:pointer-events-none transition"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Static Disclaimer */}
      <div className="p-4 rounded-xl border border-amber-100 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-950/10 text-amber-850 dark:text-amber-300 text-xs leading-relaxed flex gap-2">
        <Activity className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">No AI Diagnostics Inference:</span> This directory provides clinical descriptive analytics only. No machine learning diagnostics or automated diagnostic suggestions are applied to this patient data (SO-C Compliance).
        </div>
      </div>

      {/* Add Patient Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md bg-white dark:bg-slate-950">
          <form onSubmit={handleCreatePatient}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900 dark:text-white">
                Add Private Patient
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
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
                    className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-xs bg-white dark:bg-slate-950 text-slate-850 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 h-9"
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
                <Input id="address" name="address" placeholder="Street, Barangay, City, Province" className="text-xs h-9" />
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
                className="bg-indigo-600 hover:bg-indigo-750 text-white text-xs h-9 font-semibold"
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
