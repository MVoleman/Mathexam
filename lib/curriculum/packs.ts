/**
 * Curriculum packs — the grading engine is curriculum-agnostic; packs are
 * DATA. A pack defines the ability/criteria vocabulary that flows from
 * question registration through grading prompts to reports and analytics.
 *
 * NOTE: this module must stay client-safe (pure data, no server imports) —
 * it is used by both server pages and client components.
 *
 * DB linkage: `exams.curriculum` stores the pack id; `questions.lgr22Abilities`
 * (column kept for compatibility) stores ability CODES from the exam's pack.
 */

export type CurriculumAbility = {
  /** Stable code stored in the DB and in evaluation JSON. */
  code: string;
  /** Teacher-facing label (in the curriculum's own language). */
  label: string;
  /** One-line description used in grading prompts. */
  description: string;
};

export type CurriculumPack = {
  id: string;
  label: string;
  /** Language of rubric + formative feedback ("sv" | "en"). */
  language: "sv" | "en";
  /** How the grader persona is described in the system prompt. */
  graderPersona: string;
  abilities: CurriculumAbility[];
  /** Grade steps from lowest to highest (informational; totals use E/C/A limits today). */
  gradeScale: string[];
};

export const CURRICULUM_PACKS: Record<string, CurriculumPack> = {
  lgr22: {
    id: "lgr22",
    label: "Lgr22 (svensk grundskola)",
    language: "sv",
    graderPersona:
      "Du är en erfaren svensk matematiklärare som bedömer provsvar enligt Lgr22.",
    abilities: [
      {
        code: "concept",
        label: "Begrepp",
        description: "Använda och analysera matematiska begrepp och samband.",
      },
      {
        code: "method",
        label: "Metod",
        description: "Välja och använda lämpliga matematiska metoder för beräkningar.",
      },
      {
        code: "reasoning",
        label: "Resonemang",
        description: "Föra och följa matematiska resonemang.",
      },
      {
        code: "communication",
        label: "Kommunikation",
        description:
          "Använda matematikens uttrycksformer för att samtala om och redogöra för frågeställningar.",
      },
    ],
    gradeScale: ["F", "E", "D", "C", "B", "A"],
  },

  gy25: {
    id: "gy25",
    label: "Gy25 (svensk gymnasieskola)",
    language: "sv",
    graderPersona:
      "Du är en erfaren svensk gymnasielärare i matematik som bedömer provsvar enligt ämnesplanen i Gy25.",
    abilities: [
      {
        code: "concept",
        label: "Begrepp",
        description: "Förståelse av matematiska begrepp och samband mellan begrepp.",
      },
      {
        code: "procedure",
        label: "Procedur",
        description:
          "Hantera procedurer och lösa uppgifter av standardkaraktär, med och utan verktyg.",
      },
      {
        code: "problem_solving",
        label: "Problemlösning",
        description: "Formulera, analysera och lösa matematiska problem samt värdera strategier.",
      },
      {
        code: "modeling",
        label: "Modellering",
        description: "Tolka en realistisk situation, utforma en matematisk modell och värdera den.",
      },
      {
        code: "reasoning",
        label: "Resonemang",
        description: "Följa, föra och bedöma matematiska resonemang.",
      },
      {
        code: "communication",
        label: "Kommunikation",
        description: "Kommunicera matematiska tankegångar muntligt och skriftligt.",
      },
    ],
    gradeScale: ["F", "E", "D", "C", "B", "A"],
  },

  "ib-myp": {
    id: "ib-myp",
    label: "IB MYP Mathematics",
    language: "en",
    graderPersona:
      "You are an experienced IB MYP mathematics teacher assessing student work against the MYP assessment criteria.",
    abilities: [
      {
        code: "criterion_a",
        label: "A – Knowing and understanding",
        description:
          "Select and apply mathematics to solve problems in familiar and unfamiliar situations.",
      },
      {
        code: "criterion_b",
        label: "B – Investigating patterns",
        description:
          "Recognize patterns, describe them as relationships or rules, and justify generalizations.",
      },
      {
        code: "criterion_c",
        label: "C – Communicating",
        description:
          "Use appropriate mathematical language and forms of representation, with coherent lines of reasoning.",
      },
      {
        code: "criterion_d",
        label: "D – Applying mathematics in real-life contexts",
        description:
          "Identify relevant elements of real-life situations and apply mathematical strategies to reach valid conclusions.",
      },
    ],
    gradeScale: ["1", "2", "3", "4", "5", "6", "7"],
  },

  "ib-dp": {
    id: "ib-dp",
    label: "IB DP Mathematics (AA/AI)",
    language: "en",
    graderPersona:
      "You are an experienced IB DP mathematics teacher marking against DP markschemes (method, accuracy and reasoning marks).",
    abilities: [
      {
        code: "knowledge",
        label: "Knowledge and understanding",
        description: "Recall and apply facts, concepts and techniques.",
      },
      {
        code: "problem_solving",
        label: "Problem solving",
        description:
          "Select and apply appropriate mathematical strategies in abstract and real-world contexts.",
      },
      {
        code: "communication",
        label: "Communication and interpretation",
        description:
          "Organize and communicate work using appropriate notation, terminology and representations.",
      },
      {
        code: "reasoning",
        label: "Reasoning",
        description: "Construct mathematical arguments, proofs and justified conclusions.",
      },
      {
        code: "technology",
        label: "Use of technology",
        description: "Use technology accurately and efficiently where appropriate.",
      },
    ],
    gradeScale: ["1", "2", "3", "4", "5", "6", "7"],
  },
};

export const DEFAULT_CURRICULUM = "lgr22";

export function getPack(curriculumId: string): CurriculumPack {
  return CURRICULUM_PACKS[curriculumId] ?? CURRICULUM_PACKS[DEFAULT_CURRICULUM];
}

/** code → label map for UI badges/progress bars. */
export function getAbilityLabels(curriculumId: string): Record<string, string> {
  return Object.fromEntries(getPack(curriculumId).abilities.map((a) => [a.code, a.label]));
}

/** Ability block for grading/extraction prompts. */
export function abilityPromptBlock(pack: CurriculumPack): string {
  return pack.abilities.map((a) => `- ${a.code}: ${a.label} — ${a.description}`).join("\n");
}

export function curriculumOptions(): { id: string; label: string }[] {
  return Object.values(CURRICULUM_PACKS).map((p) => ({ id: p.id, label: p.label }));
}
