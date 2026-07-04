import { Routes, Route, Navigate } from "react-router-dom";
import { JobList } from "./components/JobList";
import { JobView } from "./components/JobView";
import { CameraCapture } from "./components/CameraCapture";
import { DescribeCircuit } from "./components/DescribeCircuit";

export default function App() {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <Routes>
        <Route path="/" element={<JobList />} />
        <Route path="/job/:jobId" element={<JobView />} />
        <Route path="/job/:jobId/capture" element={<CameraCapture />} />
        <Route path="/job/:jobId/describe" element={<DescribeCircuit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
