// Keyword hints used to find candidate BambooHR meta fields for missing schema concepts.
// This is heuristic: it produces suggestions, not ground truth.

module.exports = {
  employeeType: ['employee type', 'employment type', 'type'],
  managerId: ['supervisor', 'manager', 'reports to'],

  baseSalary: ['salary', 'pay rate', 'rate', 'compensation', 'annual', 'hourly'],
  bonus: ['bonus', 'commission', 'incentive'],
  stockOptions: ['stock', 'equity', 'options', 'rsu'],
  lastRaiseDate: ['raise', 'salary change', 'compensation change', 'effective date'],

  performanceRating: ['performance', 'rating', 'score', 'review rating'],
  reviewCycle: ['review', 'cycle', 'performance review'],
  promotionHistory: ['promotion', 'job history', 'title history'],
  managerFeedback: ['manager feedback', 'feedback', 'review comments'],

  leaveBalance: ['time off', 'leave', 'balance', 'pto', 'vacation', 'sick'],
  sickLeaveTaken: ['sick', 'time off', 'leave'],
  workHours: ['hours', 'work hours', 'scheduled hours'],
  overtimeHours: ['overtime', 'extra hours'],

  timeInRole: ['time in role', 'role start', 'job start'],
  timeAtCompany: ['tenure', 'time at company', 'length of service'],
  roleChangesCount: ['job history', 'title history', 'role change'],
  promotionsCount: ['promotion'],

  exitReason: ['exit reason', 'termination reason', 'reason for leaving'],
  voluntaryInvoluntary: ['voluntary', 'involuntary', 'termination type']
};
