// ──────────────────────────────────────────────────────────────────────────────
// profile.example.ts
//
// Copy this file to profile.ts and fill in your own details.
// profile.ts is gitignored — your personal data will never be committed.
//
//   cp src/lib/profile.example.ts src/lib/profile.ts
//
// ──────────────────────────────────────────────────────────────────────────────

export const MY_PROFILE = {
  name: 'Your Full Name',
  contact: {
    location: 'City, State ZIP',
    phone: '000-000-0000',
    email: 'you@example.com',
    linkedin: 'linkedin.com/in/your-handle',
    github: 'github.com/your-handle',
  },
  availability: 'Month YYYY – Month YYYY (Co-op / Internship)',
  education: [
    {
      degree: 'Master of Science in Computer Science',
      university: 'Your University',
      location: 'City, State',
      gpa: '0.00 / 4.00',
      expectedGraduation: 'Month YYYY',
      coursework: [
        'Course 1',
        'Course 2',
      ],
    },
    {
      degree: 'Bachelor of Engineering in Computer Engineering',
      university: 'Your University',
      location: 'City, Country',
      gpa: '0.00 / 4.00',
      graduated: 'Month YYYY',
    },
  ],
  skills: {
    languages: ['Language 1', 'Language 2'],
    frameworks: ['Framework 1', 'Framework 2'],
    databases: ['Database 1'],
    tools: ['Tool 1', 'Tool 2'],
    csFundamentals: ['Data Structures & Algorithms', 'System Design'],
  },
  experience: [
    {
      company: 'Company Name',
      location: 'City, Country',
      title: 'Job Title',
      duration: 'Month YYYY – Month YYYY',
      highlights: [
        'What you built, what impact it had, what technologies you used.',
        'Another bullet with a metric if possible.',
      ],
    },
  ],
  projects: [
    {
      name: 'Project Name',
      tech: 'Tech stack used',
      date: 'Month YYYY',
      highlights: [
        'What the project does and what makes it interesting.',
      ],
    },
  ],
  publications: [
    // Remove this section if you have no publications
    {
      title: 'Paper Title',
      venue: 'Conference / Journal, YYYY',
      note: 'One sentence summary.',
    },
  ],
  seeking: 'SDE Co-op / Internship – Month YYYY to Month YYYY',
  visaStatus: 'F-1 student visa – eligible for CPT/OPT', // update or remove as appropriate
} as const;

export type ProfileType = typeof MY_PROFILE;
