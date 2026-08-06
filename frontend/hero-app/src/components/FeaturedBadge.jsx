import { motion } from "motion/react";

export function FeaturedBadge() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex justify-center mb-8"
    >
      <div className="p-1 bg-white/10 backdrop-blur-sm rounded-full cursor-pointer hover:bg-white/20 transition-colors duration-300">
        <div className="px-4 py-1.5 bg-white/90 backdrop-blur-md rounded-full text-[#1f2937] text-sm font-medium tracking-wide">
          Featured in HR Leaders Weekly
        </div>
      </div>
    </motion.div>
  );
}
