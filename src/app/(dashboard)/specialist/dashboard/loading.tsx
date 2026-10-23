// Section-level loading boundary. The group-level `(dashboard)/loading.tsx`
// was removed (issue #213): it streamed a 200 before notFound() could run on
// the dynamic-id routes. Only sections whose routes never call notFound()
// after an await keep a loading.tsx; a boundary here must never wrap one.
export { default } from "@/components/DashboardSectionSkeleton";
