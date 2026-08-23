import { motion } from "motion/react";

export function MetricCard({ title, value, description, icon: Icon, trend }) {
  return (
    <motion.div
      className="surface-card p-6 rounded-2xl relative overflow-hidden"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#0f766e] via-[#1d9489] to-[#5bbfb3]" />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.08em] font-semibold text-[#64748b]">{title}</p>
          <p className="mt-3 text-3xl font-semibold text-[#172033]">{value}</p>
        </div>
        <div className="p-2.5 bg-[#0f766e]/10 rounded-xl text-[#0f766e] border border-[#0f766e]/20">
          <Icon className="w-6 h-6" />
        </div>
      </div>
      <div className="mt-4 flex items-center text-sm">
        <span className={trend === "up" ? "text-[#0f766e]" : trend === "down" ? "text-[#b45309]" : "text-[#64748b]"}>
          {description}
        </span>
      </div>
    </motion.div>
  );
}
