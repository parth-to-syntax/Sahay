import {
  User,
  Mail,
  Briefcase,
  Key,
  LogOut,
} from "lucide-react";
import { Link } from "react-router-dom";

export function Profile() {
  const user = {
    name: "Parth Srivastava",
    email: "parth.srivastava660@gmail.com",
    role: "hr manager",
    department: "HR",
    avatar: "PS"
  };

  const field = (label, Icon, key) => (
    <div className="sm:col-span-1">
      <dt className="text-sm font-medium text-gray-500 flex items-center mb-1">
        <Icon className="w-4 h-4 mr-1 text-gray-400" /> {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-900">{user[key]}</dd>
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
            <Link
              to="/login"
              className="flex items-center gap-1.5 px-4 py-2 bg-red-50 border border-red-200 rounded-md text-sm font-medium text-red-600 hover:bg-red-100 transition-colors h-fit"
            >
              <LogOut className="w-4 h-4" /> Logout
            </Link>
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
    </div>
  );
}
