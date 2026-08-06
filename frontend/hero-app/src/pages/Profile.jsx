import { useEffect, useState } from "react";
import {
  User,
  Mail,
  Briefcase,
  Key,
  Pencil,
  Check,
  X,
  LogOut,
  Eye,
  EyeOff,
  Shield,
  Link2,
} from "lucide-react";
import { Link } from "react-router-dom";

const EMPTY_USER = {
  name: "",
  email: "",
  role: "",
  department: "",
  avatar: "",
};

const INTEGRATION_STORAGE_KEY = "chroIntegrationConfig.v1";

const INTEGRATION_DEFS = [
  {
    id: "groq",
    name: "Groq LLM",
    fields: [
      { key: "GROQ_API_KEY", label: "GROQ_API_KEY", secret: true, placeholder: "gsk_..." },
      { key: "GROQ_MODEL", label: "GROQ_MODEL", secret: false, placeholder: "llama-3.3-70b-versatile" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    fields: [
      { key: "SLACK_BOT_TOKEN", label: "SLACK_BOT_TOKEN", secret: true, placeholder: "xoxb-..." },
      { key: "SLACK_GENERAL_CHANNEL_ID", label: "SLACK_GENERAL_CHANNEL_ID", secret: false, placeholder: "C0..." },
      { key: "SLACK_RANDOM_CHANNEL_ID", label: "SLACK_RANDOM_CHANNEL_ID", secret: false, placeholder: "C0..." },
    ],
  },
  {
    id: "bamboohr",
    name: "BambooHR",
    fields: [
      { key: "BAMBOOHR_COMPANY", label: "BAMBOOHR_COMPANY", secret: false, placeholder: "your-company" },
      { key: "BAMBOOHR_API_KEY", label: "BAMBOOHR_API_KEY", secret: true, placeholder: "api_key" },
    ],
  },
  {
    id: "google",
    name: "Google OAuth",
    fields: [
      { key: "GOOGLE_CLIENT_ID", label: "GOOGLE_CLIENT_ID", secret: true, placeholder: "...apps.googleusercontent.com" },
      { key: "GOOGLE_CLIENT_SECRET", label: "GOOGLE_CLIENT_SECRET", secret: true, placeholder: "GOCSPX-..." },
      { key: "GOOGLE_REDIRECT_URI", label: "GOOGLE_REDIRECT_URI", secret: false, placeholder: "http://localhost:4000/api/calendar/google/oauth/callback" },
    ],
  },
  {
    id: "database",
    name: "MongoDB",
    fields: [
      { key: "MONGO_URI", label: "MONGO_URI", secret: true, placeholder: "mongodb+srv://..." },
      { key: "MONGO_DB", label: "MONGO_DB", secret: false, placeholder: "hrparth" },
    ],
  },
];

function readIntegrationState() {
  try {
    const raw = window.localStorage.getItem(INTEGRATION_STORAGE_KEY);
    if (!raw) {
      return { values: {}, connected: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      values: parsed?.values && typeof parsed.values === "object" ? parsed.values : {},
      connected: parsed?.connected && typeof parsed.connected === "object" ? parsed.connected : {},
    };
  } catch (_err) {
    return { values: {}, connected: {} };
  }
}

function persistIntegrationState(values, connected) {
  try {
    window.localStorage.setItem(
      INTEGRATION_STORAGE_KEY,
      JSON.stringify({ values, connected, updatedAt: new Date().toISOString() })
    );
  } catch (_err) {
    // Ignore storage issues and keep in-memory state.
  }
}

export function Profile() {
  const [user, setUser] = useState(EMPTY_USER);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_USER });
  const [integrationValues, setIntegrationValues] = useState({});
  const [connectedByIntegration, setConnectedByIntegration] = useState({});
  const [visibleByField, setVisibleByField] = useState({});
  const [integrationNotice, setIntegrationNotice] = useState("");

  useEffect(() => {
    try {
      const name = window.localStorage.getItem("userName") || "";
      const email = window.localStorage.getItem("userEmail") || "";
      const role = window.localStorage.getItem("userRole") || "";
      const department = window.localStorage.getItem("userDepartment") || "";
      const avatar = name
        .split(" ")
        .map((n) => n[0] || "")
        .join("")
        .toUpperCase();
      const nextUser = { name, email, role, department, avatar };
      setUser(nextUser);
      setDraft(nextUser);

      const state = readIntegrationState();
      setIntegrationValues(state.values);
      setConnectedByIntegration(state.connected);
    } catch (_err) {
      setUser(EMPTY_USER);
      setDraft(EMPTY_USER);
    }
  }, []);

  const handleEdit = () => {
    setDraft({ ...user });
    setIsEditing(true);
  };

  const handleSave = () => {
    const initials = draft.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
    const nextUser = { ...draft, avatar: initials };
    setUser(nextUser);
    try {
      window.localStorage.setItem("userName", nextUser.name || "");
      window.localStorage.setItem("userEmail", nextUser.email || "");
      window.localStorage.setItem("userRole", nextUser.role || "");
      window.localStorage.setItem("userDepartment", nextUser.department || "");
    } catch (_err) {
      // Ignore storage failures and keep in-memory profile state.
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraft({ ...user });
    setIsEditing(false);
  };

  const updateIntegrationField = (fieldKey, value) => {
    const nextValues = {
      ...integrationValues,
      [fieldKey]: value,
    };
    setIntegrationValues(nextValues);
    persistIntegrationState(nextValues, connectedByIntegration);
  };

  const toggleFieldVisibility = (fieldKey) => {
    setVisibleByField((prev) => ({
      ...prev,
      [fieldKey]: !prev[fieldKey],
    }));
  };

  const connectIntegration = (integrationDef) => {
    const allRequiredPresent = integrationDef.fields.every((field) => {
      const value = String(integrationValues[field.key] || "").trim();
      return value.length > 0;
    });

    if (!allRequiredPresent) {
      setIntegrationNotice(`Please fill all ${integrationDef.name} fields before connecting.`);
      return;
    }

    const nextConnected = {
      ...connectedByIntegration,
      [integrationDef.id]: true,
    };
    setConnectedByIntegration(nextConnected);
    persistIntegrationState(integrationValues, nextConnected);
    setIntegrationNotice(`${integrationDef.name} marked as connected (frontend-only).`);
  };

  const disconnectIntegration = (integrationDef) => {
    const nextConnected = {
      ...connectedByIntegration,
      [integrationDef.id]: false,
    };
    setConnectedByIntegration(nextConnected);
    persistIntegrationState(integrationValues, nextConnected);
    setIntegrationNotice(`${integrationDef.name} marked as disconnected.`);
  };

  const field = (label, Icon, key, type = "text") => (
    <div className="sm:col-span-1">
      <dt className="text-sm font-medium text-gray-500 flex items-center mb-1">
        <Icon className="w-4 h-4 mr-1 text-gray-400" /> {label}
      </dt>
      {isEditing ? (
        <input
          type={type}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a6c]/50 focus:border-[#1f7a6c]"
        />
      ) : (
        <dd className="mt-1 text-sm text-gray-900">{user[key]}</dd>
      )}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1f2937]">Your Profile</h1>
        <p className="text-gray-500 mt-1">Manage your account settings and preferences.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Cover */}
        <div className="h-32 bg-gradient-to-r from-[#1f7a6c] to-[#3a9c8e]" />

        {/* Profile header */}
        <div className="px-8 pb-6 flex flex-col sm:flex-row relative">
          <div className="-mt-12 mb-4 sm:mb-0 mr-6">
            <div className="w-24 h-24 rounded-full border-4 border-white bg-gray-100 flex items-center justify-center text-3xl font-bold text-[#1f7a6c] shadow-md select-none">
              {user.avatar}
            </div>
          </div>

          <div className="flex-1 mt-2">
            <h2 className="text-2xl font-bold text-[#1f2937]">{user.name}</h2>
            <p className="text-gray-500 text-sm font-medium">{user.role}</p>
          </div>

          <div className="mt-4 sm:mt-2 flex gap-3 items-start">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#1f7a6c] text-white rounded-md text-sm font-medium hover:bg-[#165a50] transition-colors h-fit"
                >
                  <Check className="w-4 h-4" /> Save Changes
                </button>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors h-fit"
                >
                  <X className="w-4 h-4" /> Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors h-fit"
                >
                  <Pencil className="w-4 h-4" /> Edit Profile
                </button>
                <Link
                  to="/login"
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border border-red-200 rounded-md text-sm font-medium text-red-600 hover:bg-red-100 transition-colors h-fit"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Fields */}
        <div className="border-t border-gray-200 px-8 py-6">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            {field("Full name",   User,      "name")}
            {field("Role",        Briefcase, "role")}
            {field("Email",       Mail,      "email", "email")}
            {field("Department",  Key,       "department")}
          </dl>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-200 bg-gray-50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-[#1f2937] flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#1f7a6c]" />
                API Keys and Env Configuration
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Frontend-only storage. Keys are saved in this browser local storage and are not sent to backend by this screen.
              </p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-6">
          {integrationNotice && (
            <div className="text-sm text-[#1f7a6c] bg-[#1f7a6c]/10 border border-[#1f7a6c]/20 px-4 py-2 rounded-md">
              {integrationNotice}
            </div>
          )}

          {INTEGRATION_DEFS.map((integration) => {
            const isConnected = Boolean(connectedByIntegration[integration.id]);

            return (
              <div key={integration.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div>
                    <h4 className="font-semibold text-[#1f2937] flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-[#1f7a6c]" />
                      {integration.name}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      Status: {isConnected ? "Connected" : "Not connected"}
                    </p>
                  </div>

                  {isConnected ? (
                    <button
                      type="button"
                      onClick={() => disconnectIntegration(integration)}
                      className="px-3 py-1.5 rounded-md text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                    >
                      Connected
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectIntegration(integration)}
                      className="px-3 py-1.5 rounded-md text-sm font-medium bg-[#1f7a6c] text-white hover:bg-[#165a50]"
                    >
                      Connect
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {integration.fields.map((fieldDef) => {
                    const value = String(integrationValues[fieldDef.key] || "");
                    const visible = Boolean(visibleByField[fieldDef.key]);
                    const shouldHide = fieldDef.secret && !visible;

                    return (
                      <div key={fieldDef.key}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{fieldDef.label}</label>
                        <div className="relative">
                          <input
                            type={shouldHide ? "password" : "text"}
                            value={value}
                            onChange={(e) => updateIntegrationField(fieldDef.key, e.target.value)}
                            placeholder={fieldDef.placeholder}
                            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a6c]/50 focus:border-[#1f7a6c]"
                            autoComplete="off"
                          />

                          {fieldDef.secret && (
                            <button
                              type="button"
                              onClick={() => toggleFieldVisibility(fieldDef.key)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#1f7a6c]"
                              aria-label={visible ? "Hide value" : "Show value"}
                            >
                              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
