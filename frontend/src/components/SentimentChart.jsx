import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function SentimentChart({ data = [] }) {
  return (
    <div className="surface-card p-6 rounded-2xl col-span-1 lg:col-span-2">
      <h3 className="text-lg font-semibold text-[#172033] mb-6">Employee Sentiment Distribution</h3>
      <div className="h-[300px] w-full">
        {data.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-sm text-[#64748b]">
            No sentiment data available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dde7eb" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 13 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 13 }} />
              <Tooltip
                cursor={{ fill: "#eef6f4" }}
                contentStyle={{ borderRadius: "12px", border: "1px solid #d7e3e6", boxShadow: "0 8px 24px rgba(23, 32, 51, 0.12)" }}
              />
              <Bar dataKey="value" fill="#0f766e" radius={[8, 8, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
