import { BookOpen, Camera, CalendarClock, FileText, Lightbulb, ListChecks, Mic, Video } from 'lucide-react';

// One general note, many shapes. The user picks the type when creating a note and
// can change it later (text-like types). There is no limit on notes of any type.
export const NOTE_TYPES = [
  { id: 'text', label: 'Text note', hint: 'Quick note or thought', Icon: FileText, tone: 'butter', color: 'lilac', template: '' },
  { id: 'checklist', label: 'Task / checklist', hint: 'Track your to-dos', Icon: ListChecks, tone: 'mint', color: 'mint', template: '' },
  { id: 'research', label: 'Research note', hint: 'Save findings & links', Icon: BookOpen, tone: 'lavender', color: 'butter', template: 'Question:\n\nSources:\n\nFindings:\n' },
  { id: 'decision', label: 'Decision', hint: 'Record important choices', Icon: Lightbulb, tone: 'peach', color: 'peach', template: 'Decision:\n\nWhy:\n\nOther options considered:\n' },
  { id: 'reminder', label: 'Reminder', hint: 'Set a deadline or alert', Icon: CalendarClock, tone: 'lavender', color: 'peach', template: '' },
  { id: 'voice', label: 'Voice note', hint: 'Record audio', Icon: Mic, tone: 'sky', color: 'lilac', template: '' },
  { id: 'image', label: 'Screenshot note', hint: 'Capture your screen or add an image', Icon: Camera, tone: 'rose', color: 'peach', template: '' },
  { id: 'video', label: 'Video note', hint: 'Record a short video', Icon: Video, tone: 'mint', color: 'mint', template: '' },
];

// Types whose content is written text and can be switched freely inside a note.
export const TEXT_TYPES = ['text', 'checklist', 'research', 'decision', 'reminder'];
export const CAPTURE_TYPES = ['image', 'voice', 'video'];
export const NOTE_COLORS = ['butter', 'mint', 'lilac', 'peach'];

export const typeById = (id) => NOTE_TYPES.find((t) => t.id === id) || NOTE_TYPES[0];
