// Canonical field wishlist based on your schema requirements.
// These are NOT BambooHR field aliases; they are the app's desired concepts.

module.exports = {
  identity: [
    'employeeId',
    'firstName',
    'lastName',
    'displayName',
    'preferredName',
    'workEmail',
    'workPhone',
    'mobilePhone',
    'gender',
    'jobTitle',
    'location'
  ],
  employment: [
    'jobTitle',
    'department',
    'division',
    'manager',
    'managerId',
    'hireDate',
    'employmentStatus',
    'employeeType'
  ],
  compensation: [
    'baseSalary',
    'bonus',
    'stockOptions',
    'salaryBand',
    'payBand',
    'lastRaiseDate'
  ],
  performance: [
    'performanceRating',
    'reviewCycle',
    'promotionHistory',
    'managerFeedback'
  ],
  attendanceLeave: [
    'leaveBalance',
    'sickLeaveTaken',
    'workHours',
    'overtimeHours'
  ],
  tenureMobility: [
    'timeInRole',
    'timeAtCompany',
    'roleChangesCount',
    'promotionsCount',
    'jobLevel'
  ],
  offboarding: [
    'terminationDate',
    'finalDate',
    'exitReason',
    'voluntaryInvoluntary'
  ]
};
