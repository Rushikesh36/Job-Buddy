export interface RecruiterInfo {
  recruiterName: string;
  recruiterEmail: string;
  companyName: string;
  jobTitle: string;
  department?: string;
}

export function buildRecruiterExtractionPrompt(pageContent: string): string {
  return `Extract the recruiter information from this job posting. Return ONLY a JSON object with no markdown.

{
  "recruiter_name": "Full name of the hiring manager or recruiter, or 'Hiring Team' if not specified",
  "recruiter_email": "Email address to send to (required), or empty string if not found",
  "company_name": "Company name",
  "job_title": "Job position title",
  "department": "Department (optional, or empty string if not found)"
}

Rules:
- Search for contact emails, recruiter name, hiring manager name, application email
- If multiple emails found, use the one most likely to be from HR/recruiting
- If no recruiter name found, use "Hiring Manager" or "Hiring Team"
- recruiter_email is REQUIRED - search thoroughly for any email on the page

Job posting:
${pageContent}`;
}

export function parseRecruiterInfo(jsonText: string): RecruiterInfo {
  try {
    const fencedMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/i);
    const candidate = fencedMatch?.[1] ?? jsonText;

    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
      throw new Error('Invalid JSON');
    }

    const jsonString = candidate.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonString) as Record<string, string>;

    return {
      recruiterName: parsed.recruiter_name || 'Hiring Team',
      recruiterEmail: parsed.recruiter_email || '',
      companyName: parsed.company_name || '',
      jobTitle: parsed.job_title || '',
      department: parsed.department || '',
    };
  } catch {
    return {
      recruiterName: 'Hiring Team',
      recruiterEmail: '',
      companyName: '',
      jobTitle: '',
      department: '',
    };
  }
}

export function buildColdEmailBody(params: {
  recruiterName: string;
  companyName: string;
  jobTitle: string;
}): string {
  const { recruiterName, companyName, jobTitle } = params;

  return `Hi ${recruiterName},

I’m reaching out about the ${jobTitle} role at ${companyName}. I read through the posting carefully, and the role stood out to me because it feels closely aligned with the kind of work I want to do next.

What I’d bring is a strong sense of ownership, clear communication, and a genuine willingness to learn quickly and contribute thoughtfully from day one. I care about doing solid work, being dependable, and adding value to the team in a way that makes your job easier, not harder.

I’ve attached my resume for your review. If my background is a fit, I’d really appreciate the chance to speak further and share more about how I can contribute.

Thanks for your time and consideration.

Best,`;
}
