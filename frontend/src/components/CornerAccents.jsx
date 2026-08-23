import { motion } from "motion/react";

export function CornerAccents() {
  return (
    <>
      {/* Top Left */}
      <div className="absolute top-0 left-0 w-[7px] h-[7px] bg-white opacity-50"></div>
      {/* Top Right */}
      <div className="absolute top-0 right-0 w-[7px] h-[7px] bg-white opacity-50"></div>
      {/* Bottom Left */}
      <div className="absolute bottom-0 left-0 w-[7px] h-[7px] bg-white opacity-50"></div>
      {/* Bottom Right */}
      <div className="absolute bottom-0 right-0 w-[7px] h-[7px] bg-white opacity-50"></div>
    </>
  );
}
