import { StaffSurface } from "@/components/staff/StaffSurface";
export default function StaffImportsPage() { return <StaffSurface title="Question import" description="Accessible upload and preview boundary for the Stage 23 import pipeline." resource="POST /api/v1/admin/imports/preview" stage23 />; }
