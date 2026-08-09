import { StaffSurface } from "@/components/staff/StaffSurface";
export default function StaffQuestionsPage() { return <StaffSurface title="Question bank" description="Filter immutable question revisions by lesson, workflow status, type, difficulty, author and quality evidence." resource="GET /api/v1/admin/questions" />; }
