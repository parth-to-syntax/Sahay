import { AlertTriangle, ShieldAlert } from "lucide-react";

function badgeClassForSeverity(severity) {
  if (severity === "Critical") return "bg-red-100 text-red-800";
  if (severity === "High") return "bg-amber-100 text-amber-800";
  if (severity === "Medium") return "bg-yellow-100 text-yellow-800";
  return "bg-slate-100 text-slate-700";
}

function iconClassForSeverity(severity) {
  if (severity === "Critical") return "text-red-600";
  if (severity === "High") return "text-amber-600";
  if (severity === "Medium") return "text-yellow-600";
  return "text-slate-500";
}

export function DashboardAlerts({ alerts = [], onSelectEmployee }) {
  return (
    <div className="surface-card rounded-2xl overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-[#1f7a6c]" />
          <h3 className="text-lg font-semibold text-[#1f2937]">Alerts</h3>
        </div>
        <span className="text-xs text-gray-400">Live risk signals</span>
      </div>

      <div className="divide-y divide-gray-100">
        {alerts.length === 0 && (
          <div className="px-6 py-8 text-sm text-gray-500">
            No active alerts. Workforce signals are stable.
          </div>
        )}

        {alerts.map((alert) => (
          <button
            key={`${alert.employeeEmail}:${alert.type}`}
            type="button"
            className="w-full text-left px-6 py-4 hover:bg-[#1f7a6c]/5 transition-colors"
            onClick={() => onSelectEmployee?.(alert.employee)}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className={`h-4 w-4 mt-0.5 ${iconClassForSeverity(alert.severity)}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900 truncate">{alert.title}</p>
                  <span className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full ${badgeClassForSeverity(alert.severity)}`}>
                    {alert.severity}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
