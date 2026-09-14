export function progressVisual(status) {
  if (status === 'complete') return { text: 'Complete', icon: 'check' };
  if (status === 'in_progress') return { text: 'In Progress...', icon: 'info' };
  return { text: 'Not Started...', icon: 'lock' };
}
