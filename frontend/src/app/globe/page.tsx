import type { Metadata } from "next";
import GodEyeCommandCenter from "@/components/godseye/GodEyeCommandCenter";

export const metadata: Metadata = {
  title: "God's Eye — Global Conflict Command Center",
  description: "A cinematic real-time 3D Earth interface for monitoring global conflict theaters, incident signals, and humanitarian impact.",
};

export default function GlobeScene() {
  return <GodEyeCommandCenter />;
}
