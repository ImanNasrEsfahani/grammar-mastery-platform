import { StaffSurface } from "@/components/staff/StaffSurface";
export default function StaffQuestionPage() { return <StaffSurface title="Question editor" description="Edit through a new revision; never mutate published historical content in place." resource="GET/PATCH /api/v1/admin/questions/{questionId}" />; }
