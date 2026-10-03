import type { ResponseInput } from "./api";

export interface Reference {
  figure: string;
  text: string;
  source: string;
  url: string;
  you?: (r: ResponseInput, schoolSlug: string) => string | null;
}

// Published figures shown for context while a school's sample is still small.
export const REFERENCES: Reference[] = [
  {
    figure: "87%",
    text: "of Waterloo's CS class of 2024 attended at least one hackathon by graduation.",
    source: "Waterloo CS Club, 2024 class profile",
    url: "https://csclub.uwaterloo.ca/classprofile/2024/cs-experience",
    you: (r) => (r.hackathons == null ? null : `You: ${r.hackathons} so far.`),
  },
  {
    figure: "30%+",
    text: "of Waterloo's CS class of 2023 finished 3 or more side projects during their degree.",
    source: "Waterloo CS Club, 2023 class profile",
    url: "https://csclub.uwaterloo.ca/classprofile/2023/computer-science-experience",
    you: (r) => (r.projects == null ? null : `You: ${r.projects} finished.`),
  },
  {
    figure: "6",
    text: "median programming languages known by Waterloo's CS class of 2023 (middle half: 4–8).",
    source: "Waterloo CS Club, 2023 class profile",
    url: "https://csclub.uwaterloo.ca/classprofile/2023/computer-science-experience",
    you: (r) => (r.languages == null ? null : `You: ${r.languages}.`),
  },
  {
    figure: "40%",
    text: "of CS undergrads in a multi-institution study had done an internship (57.5% by senior year).",
    source: "Kapoor & Gardner-McCune, SIGCSE 2020",
    url: "https://kapooramanpreet.github.io/documents/research/papers/Internships_Participation_SIGCSE20_Kapoor&Gardner-McCune.pdf",
    you: (r) => (r.internships == null ? null : `You: ${r.internships}.`),
  },
  {
    figure: "8.5",
    text: "term GPA out of 10, with no failures, is the bar for uOttawa's Dean's Honour List.",
    source: "uOttawa Academic Regulation B-8",
    url: "https://www.uottawa.ca/about-us/leadership-governance/policies-regulations/b-8-distinctions",
    you: (r, slug) => (slug === "uottawa" && r.gpa != null ? `You: ${r.gpa} CGPA.` : null),
  },
];
