import "server-only";

import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { getStudentReport } from "@/lib/queries";
import { getAbilityLabels } from "@/lib/curriculum/packs";

/**
 * Server-rendered PDF of a student's formative report — same content as the
 * portal view: totals, ability rates and per-question formative feedback.
 * No AI internals (reasoning, confidences, second opinions).
 */

type Report = NonNullable<Awaited<ReturnType<typeof getStudentReport>>>;

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#18181b" },
  header: { marginBottom: 16, borderBottom: "1 solid #d4d4d8", paddingBottom: 10 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, color: "#71717a", marginTop: 2 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
    backgroundColor: "#f4f4f5",
    padding: 10,
    borderRadius: 4,
  },
  totalLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6, marginTop: 10 },
  abilityRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  abilityLabel: { width: 220 },
  barTrack: { flexGrow: 1, height: 6, backgroundColor: "#e4e4e7", borderRadius: 3 },
  barFill: { height: 6, backgroundColor: "#18181b", borderRadius: 3 },
  abilityPct: { width: 36, textAlign: "right" },
  question: {
    marginBottom: 10,
    padding: 8,
    border: "1 solid #e4e4e7",
    borderRadius: 4,
  },
  questionHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  questionTitle: { fontFamily: "Helvetica-Bold" },
  questionText: { color: "#52525b", marginBottom: 4 },
  feedback: { backgroundColor: "#fafafa", padding: 6, borderLeft: "2 solid #a1a1aa" },
  teacherComment: { marginTop: 4, fontFamily: "Helvetica-Oblique" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#a1a1aa",
    textAlign: "center",
  },
});

export async function renderStudentReportPdf(report: Report): Promise<Buffer> {
  const { submission, totalPoints, maxPoints, grade, abilities } = report;
  const abilityLabels = getAbilityLabels(submission.exam.curriculum);

  const doc = (
    <Document
      title={`Resultatrapport — ${submission.exam.title}`}
      author="DeepGrader"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{submission.exam.title}</Text>
          <Text style={styles.subtitle}>
            {submission.exam.course} · {submission.exam.gradeLevel} · Formativ
            rapport · {submission.studentId}
          </Text>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Totalt resultat</Text>
          <Text style={styles.totalLabel}>
            {totalPoints}/{maxPoints}p{grade ? `  ·  Betygsnivå ${grade}` : ""}
          </Text>
        </View>

        {abilities.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Förmågor / kriterier</Text>
            {abilities.map((a) => (
              <View key={a.ability} style={styles.abilityRow}>
                <Text style={styles.abilityLabel}>
                  {abilityLabels[a.ability] ?? a.ability}
                </Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${a.rate}%` }]} />
                </View>
                <Text style={styles.abilityPct}>{a.rate}%</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Uppgifter</Text>
        {submission.results.map((result) => (
          <View key={result.id} style={styles.question} wrap={false}>
            <View style={styles.questionHead}>
              <Text style={styles.questionTitle}>
                Uppgift {result.question.number}
              </Text>
              <Text style={styles.questionTitle}>
                {result.awardedPoints}/{result.question.maxPoints}p
              </Text>
            </View>
            <Text style={styles.questionText}>{result.question.questionText}</Text>
            <View style={styles.feedback}>
              <Text>{result.evaluation.formativeFeedback}</Text>
            </View>
            {result.teacherComment && (
              <Text style={styles.teacherComment}>
                Lärarens kommentar: {result.teacherComment}
              </Text>
            )}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          Rapporten är granskad av läraren. Genererad av DeepGrader.
        </Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
