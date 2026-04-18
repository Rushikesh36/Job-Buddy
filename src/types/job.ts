export type VisaSponsorship = 'Yes' | 'No' | 'Unknown';
export type JobStatus = 'Saved' | 'Applied' | 'Interviewing' | 'Rejected' | 'Offer';

export interface JobData {
  dateApplied: string;
  company: string;
  role: string;
  location: string;
  jobId: string;
  jobUrl: string;
  keyRequirements: string[];
  salaryRange: string;
  visaSponsorship: VisaSponsorship;
  atsScore: number;
  resumeVersion: string;
  status: JobStatus;
  notes: string;
}

export interface JobExtractionFields {
  company_name: string;
  role_title: string;
  location: string;
  job_id: string;
  key_requirements: string[];
  salary_range: string;
  visa_sponsorship: VisaSponsorship;
  remote_hybrid_onsite: string;
}

export interface SheetsConfig {
  spreadsheetId: string | null;
  resumeVersions: string[];
}

export const DEFAULT_SHEETS_CONFIG: SheetsConfig = {
  spreadsheetId: null,
  resumeVersions: ['default'],
};

export const SHEETS_HEADERS = [
  'Date Applied',
  'Company',
  'Role',
  'Location',
  'Job ID',
  'Job URL',
  'Key Requirements (top 5)',
  'Salary Range',
  'Visa Sponsorship (Yes/No/Unknown)',
  'ATS Score',
  'Resume Version Used',
  'Status (Applied/Saved/Interviewing/Rejected/Offer)',
  'Notes',
] as const;

export const JOB_STATUS_OPTIONS: JobStatus[] = ['Saved', 'Applied', 'Interviewing', 'Rejected', 'Offer'];
export const VISA_SPONSORSHIP_OPTIONS: VisaSponsorship[] = ['Yes', 'No', 'Unknown'];
