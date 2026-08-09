/**
 * The content library — real medical-education copy for all 21 subjects the world tracks.
 *
 * Why this is one module rather than strings inside components: the same subject appears on Today
 * ("what should I do next"), as a district on the Map, as a lateral pivot inside IMAGINE, and as a
 * pinned card in the Library. If each surface wrote its own copy, the same subject would be described
 * three different ways in three places, which is how an interface stops feeling like one product.
 *
 * Keyed by DISTRICT id — `cell`, `cardio`, `renal` … — because that is the real key in the app.
 * `store.ts` builds one concept per district as `<districtId>.core`, and `seed.ts`'s PROFILES are
 * district-keyed too. `conceptId()` / `districtOf()` below convert between the two forms so no caller
 * has to remember the `.core` suffix.
 *
 * Deliberately absent: `label`. `DISTRICTS` in `store.ts` already owns display names ("Cardiovascular",
 * "Cell & Molecular"), and a second list here would drift from it within a week. Read labels from the
 * store; read everything else from here.
 *
 * On accuracy: this is study *scaffolding* — retrieval prompts and the hooks a tutor reaches for — not
 * clinical guidance. Every fact is first-order preclinical material a second-year is expected to hold.
 * Nothing here is a dosing or management recommendation and nothing here should be presented as one.
 */

/** The three rings of `DISTRICTS` in `store.ts`, named. Ring 0 → 1 → 2 is a real dependency order. */
export type RingId = 'foundations' | 'mechanism' | 'systems';

export interface Prompt {
  /** A retrieval prompt — phrased as a question, because recall is the evidence we want. */
  q: string;
  /** The answer, at the length a tutor would actually say it. One or two sentences. */
  a: string;
}

export interface SubjectCopy {
  /** District id. Must exist in `DISTRICTS` in `store.ts` — enforced by subjects.test.ts. */
  id: string;
  ring: RingId;
  /** What this subject actually is. One line, shown under the title and in hovers. */
  summary: string;
  /** The high-yield hook: the thing worth keeping if you keep one thing. */
  pearl: string;
  /**
   * Lateral pivots — other district ids to move TO. This is the data behind IMAGINE's promise of
   * "high-yield lateral pivots instead of repeating what is already on screen."
   */
  pivots: readonly string[];
  /** The near neighbour this is most often confused with. This is what 'distinguished' evidence is. */
  confusedWith?: string;
  /** Real retrieval prompts. Cards, Next Move and the focus timer all draw from these. */
  prompts: readonly Prompt[];
}

export const SUBJECTS: readonly SubjectCopy[] = [
  // ── Ring 0 · Foundations ───────────────────────────────────────────────────
  {
    id: 'cell',
    ring: 'foundations',
    summary: 'Organelles, membrane transport, and the checkpoints of the cell cycle.',
    pearl: 'Most inherited metabolic disease is one enzyme in one organelle. Locate the organelle and the presentation follows.',
    pivots: ['biochem', 'genetics', 'histo'],
    prompts: [
      { q: 'Which organelle failure causes accumulation of substrate inside the cell rather than a shortage of product?',
        a: 'Lysosomal. Storage diseases accumulate undegraded substrate; a synthetic pathway defect instead starves the cell of product.' },
      { q: 'What distinguishes primary active transport from secondary active transport?',
        a: 'Primary hydrolyses ATP directly at the transporter. Secondary spends no ATP itself — it rides a gradient that a primary pump already built.' },
      { q: 'Which cell cycle checkpoint does p53 govern, and what are its two possible outcomes?',
        a: 'The G1/S checkpoint. It either arrests the cycle for repair or, if damage is beyond repair, commits the cell to apoptosis.' },
    ],
  },
  {
    id: 'genetics',
    ring: 'foundations',
    summary: 'Inheritance patterns, penetrance and expressivity, and the repeat expansions.',
    pearl: 'Anticipation across generations means a repeat expansion — that single word narrows the differential before any lab returns.',
    pivots: ['cell', 'repro', 'heme'],
    confusedWith: 'cell',
    prompts: [
      { q: 'A trait appears in every generation and affects both sexes roughly equally. Which inheritance pattern is most likely?',
        a: 'Autosomal dominant. No generation skipping and no sex bias are its two signatures.' },
      { q: 'What is the difference between variable penetrance and variable expressivity?',
        a: 'Penetrance is whether the phenotype appears at all; expressivity is how severely it appears in those who have it.' },
      { q: 'Why do mitochondrial disorders never pass from an affected father?',
        a: 'Mitochondria are inherited from the oocyte, so transmission is exclusively maternal — though severity varies with heteroplasmy.' },
    ],
  },
  {
    id: 'biochem',
    ring: 'foundations',
    summary: 'Metabolic pathways, their regulation, and where each one is compartmentalised.',
    pearl: 'Rate-limiting steps are where both drugs and deficiencies act. Learn the step and you get the pathology and the pharmacology at once.',
    pivots: ['pharm', 'endo', 'cell'],
    prompts: [
      { q: 'Which enzyme is the rate-limiting step of glycolysis, and what is its main allosteric activator?',
        a: 'Phosphofructokinase-1, activated by fructose-2,6-bisphosphate — the signal that the fed state should push flux forward.' },
      { q: 'Why can fatty acids not be converted to glucose in humans?',
        a: 'Acetyl-CoA cannot be turned back into pyruvate; the pyruvate dehydrogenase step is irreversible, so the carbons are lost as CO2.' },
      { q: 'Which pathways are cytosolic, which are mitochondrial, and which span both?',
        a: 'Glycolysis and the pentose phosphate pathway are cytosolic; the TCA cycle and beta-oxidation are mitochondrial; gluconeogenesis, urea and haem synthesis span both.' },
    ],
  },

  // ── Ring 1 · Mechanism ────────────────────────────────────────────────────
  {
    id: 'physiology',
    ring: 'mechanism',
    summary: 'Pressure, flow, and negative feedback across every organ system.',
    pearl: 'Almost every physiology answer is a pressure gradient or a feedback loop. Name which one before reaching for a mechanism.',
    pivots: ['cardio', 'renal', 'resp'],
    prompts: [
      { q: 'Starling forces: what actually drives net filtration at a capillary?',
        a: 'The balance of hydrostatic and oncotic pressure across the wall. Filtration happens where hydrostatic pressure exceeds oncotic pull.' },
      { q: 'Why does a negative feedback loop with a longer delay tend to oscillate?',
        a: 'The correction arrives after the disturbance has already moved on, so the system overshoots and then over-corrects.' },
      { q: 'What single measurement tells you most about whether a compensatory response is adequate?',
        a: 'The controlled variable itself. If it has returned toward its set point, compensation is working regardless of how hard the effector is straining.' },
    ],
  },
  {
    id: 'pathology',
    ring: 'mechanism',
    summary: 'Cell injury, inflammation, healing, and neoplasia — how tissue actually fails.',
    pearl: 'Reversible injury is swelling; irreversible is membrane rupture. Everything downstream follows from which side of that line the cell is on.',
    pivots: ['histo', 'immuno', 'micro'],
    prompts: [
      { q: 'What is the earliest reversible morphological change in cell injury?',
        a: 'Cellular swelling from failure of the Na+/K+ ATPase, followed by blebbing and ribosomal detachment — all still reversible.' },
      { q: 'Which single feature separates apoptosis from necrosis?',
        a: 'Apoptosis is ATP-dependent, membrane-intact and non-inflammatory. Necrosis loses membrane integrity and therefore provokes inflammation.' },
      { q: 'Which four features define a malignant neoplasm rather than a benign one?',
        a: 'Invasion, metastatic capacity, loss of differentiation, and unregulated growth. Invasion is the one that matters most.' },
    ],
  },
  {
    id: 'pharm',
    ring: 'mechanism',
    summary: 'Mechanism, kinetics, and the adverse effects that follow from both.',
    pearl: 'A drug’s side effects are usually its mechanism appearing in the wrong tissue — not an unrelated list to memorise.',
    pivots: ['biochem', 'cardio', 'neuro'],
    confusedWith: 'biochem',
    prompts: [
      { q: 'What does a competitive antagonist do to an agonist’s dose–response curve?',
        a: 'Shifts it right without lowering the maximum — potency falls, efficacy does not. A non-competitive antagonist lowers the maximum instead.' },
      { q: 'Why does zero-order elimination make overdose dangerous?',
        a: 'A constant amount is cleared per unit time regardless of concentration, so once capacity is saturated, levels climb out of proportion to dose.' },
      { q: 'What determines how long a loading dose takes to reach steady state?',
        a: 'Nothing — that is the point of a loading dose. Half-life sets the time to steady state for maintenance dosing; volume of distribution sets the loading dose.' },
    ],
  },
  {
    id: 'micro',
    ring: 'mechanism',
    summary: 'Organisms, their virulence factors, and the syndromes those factors produce.',
    pearl: 'Virulence factor to clinical picture is a one-step inference. Find the toxin or the capsule and the presentation is already decided.',
    pivots: ['immuno', 'pharm', 'resp'],
    prompts: [
      { q: 'Why does a polysaccharide capsule make an organism dangerous to a splenectomised patient specifically?',
        a: 'Clearing encapsulated organisms depends on opsonisation and splenic macrophages. Without the spleen, that arm is gone.' },
      { q: 'What does an exotoxin that ADP-ribosylates a G protein do to intracellular cAMP?',
        a: 'Raises it — either by locking the stimulatory subunit on or by disabling the inhibitory one. Massive secretory diarrhoea is the classic result.' },
      { q: 'Gram stain is negative and the organism will not grow on standard media. What have you already learned?',
        a: 'That it is likely intracellular, cell-wall-deficient, or requires special media — which by itself shortlists the differential.' },
    ],
  },
  {
    id: 'immuno',
    ring: 'mechanism',
    summary: 'Innate and adaptive arms, the hypersensitivity types, and immunodeficiency.',
    pearl: 'Which cell line is missing predicts which organism gets through. The deficiency names the infection.',
    pivots: ['micro', 'heme', 'pathology'],
    prompts: [
      { q: 'A patient has recurrent viral and fungal infections from infancy. Which arm is defective?',
        a: 'T cell / cell-mediated. Recurrent encapsulated bacterial infection points at antibody or complement instead.' },
      { q: 'Which hypersensitivity type is delayed by 48–72 hours, and why is it delayed?',
        a: 'Type IV. It requires T cells to be recruited and activated, whereas types I–III use preformed antibody or mediators.' },
      { q: 'What is the functional difference between MHC class I and class II presentation?',
        a: 'Class I shows intracellular peptide to cytotoxic T cells — "what is inside me." Class II shows phagocytosed peptide to helper T cells — "what I found outside."' },
    ],
  },
  {
    id: 'histo',
    ring: 'mechanism',
    summary: 'Normal tissue architecture, and the way disease distorts it.',
    pearl: 'You cannot recognise architecture you have never seen intact. Normal slides are the higher-yield study.',
    pivots: ['pathology', 'anatomy', 'cell'],
    prompts: [
      { q: 'Which epithelium lines a surface built for abrasion, and which for absorption?',
        a: 'Stratified squamous for abrasion; simple columnar with a brush border for absorption. Form follows the mechanical demand.' },
      { q: 'What does metaplasia look like on a slide, and why does it happen?',
        a: 'One mature epithelium replaced by another — it is an adaptive response to chronic irritation, and it is reversible.' },
      { q: 'How do you tell smooth muscle from skeletal muscle at low power?',
        a: 'Striations and peripheral multiple nuclei mark skeletal. Smooth muscle has a single central nucleus and no striations.' },
    ],
  },
  {
    id: 'anatomy',
    ring: 'mechanism',
    summary: 'Structure, relationships, and the courses nerves and vessels actually take.',
    pearl: 'Deficits localise. Which nerve, at which level, explains which lost function — anatomy turns a symptom into a coordinate.',
    pivots: ['neuro', 'msk', 'histo'],
    prompts: [
      { q: 'Why does a nerve’s course matter more than its origin for predicting injury?',
        a: 'Injury happens where a nerve is mechanically vulnerable — against bone, through a tunnel, or across a joint — not at its root.' },
      { q: 'What is the practical difference between a dermatome and a peripheral nerve sensory field?',
        a: 'A dermatome maps one spinal level; a peripheral field maps one nerve carrying several levels. Which pattern is lost tells you where the lesion is.' },
      { q: 'Why does a structure passing through a fixed foramen present differently when swollen?',
        a: 'The foramen cannot expand, so swelling compresses whatever else shares the passage — the anatomy sets the syndrome.' },
    ],
  },

  // ── Ring 2 · Organ systems ────────────────────────────────────────────────
  {
    id: 'cardio',
    ring: 'systems',
    summary: 'The cardiac cycle, pressure–volume relationships, and the murmurs that follow.',
    pearl: 'Place the murmur in the cycle and the lesion names itself. Timing carries more information than intensity.',
    pivots: ['physiology', 'pharm', 'resp'],
    confusedWith: 'resp',
    prompts: [
      { q: 'On a pressure–volume loop, which segment is isovolumetric contraction?',
        a: 'The vertical rise after mitral closure — pressure climbs with no volume change because both valves are shut.' },
      { q: 'Preload rises. What happens to stroke volume and why?',
        a: 'It rises, because greater sarcomere stretch improves actin–myosin overlap. That is the Frank–Starling relationship.' },
      { q: 'Which murmurs are systolic, and what do they have in common mechanically?',
        a: 'Aortic and pulmonic stenosis, mitral and tricuspid regurgitation. All involve flow that should not be moving while the ventricle contracts.' },
    ],
  },
  {
    id: 'resp',
    ring: 'systems',
    summary: 'Ventilation, perfusion, gas exchange, and lung compliance.',
    pearl: 'V/Q mismatch versus shunt is the first fork in any hypoxia question, and the response to supplemental oxygen separates them.',
    pivots: ['cardio', 'physiology', 'micro'],
    confusedWith: 'cardio',
    prompts: [
      { q: 'Hypoxia does not improve with supplemental oxygen. What does that tell you?',
        a: 'It is a true shunt — blood bypasses ventilated alveoli entirely, so raising alveolar oxygen cannot reach it. V/Q mismatch would improve.' },
      { q: 'Why is the apex of an upright lung high V/Q and the base low V/Q?',
        a: 'Gravity increases both ventilation and perfusion toward the base, but perfusion increases more, so the ratio falls going down.' },
      { q: 'What does surfactant do to compliance and to alveolar stability?',
        a: 'It lowers surface tension, raising compliance, and it stabilises small alveoli against collapse into larger ones per Laplace’s law.' },
    ],
  },
  {
    id: 'renal',
    ring: 'systems',
    summary: 'Filtration, the nephron segments, and acid–base handling.',
    pearl: 'Countercurrent multiplication is the entire concentrating mechanism. Lose the medullary gradient and nothing downstream can concentrate.',
    pivots: ['physiology', 'endo', 'pharm'],
    prompts: [
      { q: 'Which nephron segment establishes the medullary gradient, and which one exploits it?',
        a: 'The thick ascending limb builds it by pumping solute without water. The collecting duct exploits it, but only when ADH has opened the water channels.' },
      { q: 'Why does the proximal tubule reabsorb the most while changing the urine’s concentration least?',
        a: 'It reabsorbs solute and water in nearly equal proportion — bulk reclamation, isosmotic throughout.' },
      { q: 'A metabolic acidosis is present. What is the expected respiratory response?',
        a: 'Hyperventilation lowering pCO2. If pCO2 is not falling, there is a second, respiratory disorder on top of the first.' },
    ],
  },
  {
    id: 'gi',
    ring: 'systems',
    summary: 'Motility, secretion, absorption, and the hepatic first pass.',
    pearl: 'Where absorption happens decides which deficiency a resection causes. The segment predicts the vitamin.',
    pivots: ['biochem', 'anatomy', 'pathology'],
    prompts: [
      { q: 'Terminal ileum is resected. Which two absorptive functions are lost?',
        a: 'B12 absorption, which needs intrinsic factor receptors there, and bile salt recycling — which then causes fat malabsorption too.' },
      { q: 'Why does first-pass metabolism make the oral and IV dose of some drugs so different?',
        a: 'Portal blood passes through the liver before reaching circulation, so an orally absorbed drug can be largely metabolised before it ever acts.' },
      { q: 'What is the functional consequence of losing gastric parietal cells?',
        a: 'Both acid and intrinsic factor are lost — so impaired protein digestion and iron absorption, plus eventual B12 deficiency.' },
    ],
  },
  {
    id: 'endo',
    ring: 'systems',
    summary: 'Hormone axes, feedback, and the failure mode at each level of an axis.',
    pearl: 'Primary versus secondary is settled by the trophic hormone: high trophic with low target output means the gland failed, not the axis.',
    pivots: ['renal', 'biochem', 'repro'],
    confusedWith: 'repro',
    prompts: [
      { q: 'Target hormone is low and the trophic hormone is also low. Where is the lesion?',
        a: 'Above the gland — pituitary or hypothalamus. A failed gland would leave the trophic hormone high from lost negative feedback.' },
      { q: 'Why do steroid and peptide hormones differ in how fast they act?',
        a: 'Peptides use surface receptors and second messengers, so they act in seconds. Steroids alter transcription, so they act over hours.' },
      { q: 'What does a suppression test establish that a single level cannot?',
        a: 'Whether the axis still responds to feedback. An autonomous source keeps secreting when a normal one would shut off.' },
    ],
  },
  {
    id: 'neuro',
    ring: 'systems',
    summary: 'Tracts, localisation, and the vascular territories.',
    pearl: 'Crossed findings put the lesion in the brainstem, and the cranial nerve involved gives you the level.',
    pivots: ['anatomy', 'pharm', 'psych'],
    prompts: [
      { q: 'Which two tracts cross where, and why does that matter for a spinal lesion?',
        a: 'Spinothalamic crosses at the cord within a couple of segments; corticospinal crosses in the medulla. So a cord lesion gives contralateral pain loss but ipsilateral weakness.' },
      { q: 'Which signs distinguish an upper motor neuron lesion from a lower one?',
        a: 'Upper gives hypertonia, hyperreflexia and an upgoing toe. Lower gives atrophy, fasciculation and lost reflexes.' },
      { q: 'Why does an anterior cerebral artery stroke affect the leg more than the arm?',
        a: 'Its territory covers the medial cortex, where the leg is represented on the motor homunculus.' },
    ],
  },
  {
    id: 'msk',
    ring: 'systems',
    summary: 'Bone remodelling, joint pathology, and muscle mechanics.',
    pearl: 'Inflammatory joint pain is worse after rest; mechanical pain is worse after use. The history separates them before any imaging.',
    pivots: ['anatomy', 'immuno', 'pathology'],
    prompts: [
      { q: 'Which cell resorbs bone, which builds it, and which hormone shifts the balance toward resorption?',
        a: 'Osteoclasts resorb, osteoblasts build, and sustained parathyroid hormone favours resorption — though pulsatile PTH does the opposite.' },
      { q: 'Morning stiffness lasting over an hour and improving with movement. Inflammatory or mechanical?',
        a: 'Inflammatory. Mechanical stiffness is brief and worsens as the joint is used through the day.' },
      { q: 'Why does eccentric contraction generate more force than concentric?',
        a: 'The muscle is lengthening under load, so passive elastic elements bear force alongside active cross-bridges.' },
    ],
  },
  {
    id: 'heme',
    ring: 'systems',
    summary: 'Cell lines, haemostasis, and the anaemias.',
    pearl: 'Start every anaemia with the MCV. It splits the differential three ways before any other test returns.',
    pivots: ['immuno', 'genetics', 'pharm'],
    prompts: [
      { q: 'Microcytic anaemia: what does the differential reduce to mechanistically?',
        a: 'Not enough haem or not enough globin — iron deficiency and sideroblastic on one side, thalassaemia on the other.' },
      { q: 'Which pathway does the PT measure, and which does the PTT measure?',
        a: 'PT the extrinsic (tissue factor, VII); PTT the intrinsic (VIII, IX, XI, XII). Both share the common pathway from X onward.' },
      { q: 'Why does a reticulocyte count change the meaning of an anaemia?',
        a: 'It separates underproduction from loss or destruction. A marrow that is responding proves the problem is downstream of production.' },
    ],
  },
  {
    id: 'repro',
    ring: 'systems',
    summary: 'Gonadal axes, the menstrual cycle, and sexual development.',
    pearl: 'The cycle is one feedback loop read twice. Follicular and luteal differ in which hormone dominates, not in the mechanism.',
    pivots: ['endo', 'genetics', 'anatomy'],
    confusedWith: 'endo',
    prompts: [
      { q: 'What converts oestrogen’s feedback on LH from negative to positive?',
        a: 'Sustained high oestrogen late in the follicular phase. That switch is what produces the LH surge and therefore ovulation.' },
      { q: 'Which structure maintains the early luteal phase, and what rescues it in pregnancy?',
        a: 'The corpus luteum, rescued by hCG from the trophoblast — which is why hCG is the earliest pregnancy signal.' },
      { q: 'Why does absence of the Y chromosome produce a female phenotype by default?',
        a: 'Without SRY there is no testis, so no testosterone and no anti-Müllerian hormone — and the Müllerian ducts develop unopposed.' },
    ],
  },
  {
    id: 'psych',
    ring: 'systems',
    summary: 'Diagnostic criteria, timelines, and psychopharmacology.',
    pearl: 'Duration is usually the discriminator between two otherwise identical presentations. The timeline is the diagnosis.',
    pivots: ['neuro', 'pharm'],
    prompts: [
      { q: 'Why is duration written into so many psychiatric criteria?',
        a: 'Because the cross-sectional picture is often identical between a transient reaction and a chronic disorder. Time is the only distinguishing axis.' },
      { q: 'What separates a delusion from an overvalued idea?',
        a: 'Fixity in the face of contradicting evidence, and the fact that the belief is not shared by the person’s culture.' },
      { q: 'Which class of medication requires a washout before starting another, and why?',
        a: 'Irreversible MAO inhibitors. Enzyme activity returns only as new enzyme is synthesised, so overlap risks a serotonergic crisis.' },
    ],
  },
  {
    id: 'derm',
    ring: 'systems',
    summary: 'Primary lesion morphology, and the systemic disease it can signal.',
    pearl: 'Name the primary lesion first — macule, papule, vesicle. Morphology, not location, drives the differential.',
    pivots: ['immuno', 'pathology', 'micro'],
    prompts: [
      { q: 'Which two axes separate a macule, a papule, a plaque and a vesicle?',
        a: 'Elevation and size. Flat is a macule; raised and small is a papule; raised and broad is a plaque; fluid-filled is a vesicle.' },
      { q: 'Why does the depth of a blister change the prognosis?',
        a: 'A deeper, subepidermal split means a wider area of separation and a worse barrier failure than a superficial intraepidermal one.' },
      { q: 'What makes a rash worth reading as a systemic sign rather than a skin problem?',
        a: 'Mucosal involvement, fever, or rapid progression — the skin is often the first visible organ in a systemic process.' },
    ],
  },
] as const;

const BY_ID = new Map(SUBJECTS.map(s => [s.id, s]));

/** The concept id the learner model uses for a district, per `store.ts`'s `seedDistricts()`. */
export function conceptId(districtId: string): string {
  return `${districtId}.core`;
}

/** Inverse of `conceptId` — tolerant of already-bare district ids so callers need not check. */
export function districtOf(conceptId: string): string {
  const dot = conceptId.indexOf('.');
  return dot === -1 ? conceptId : conceptId.slice(0, dot);
}

/** Copy for a district id or a `<district>.core` concept id. Either form works. */
export function subject(id: string): SubjectCopy | undefined {
  return BY_ID.get(BY_ID.has(id) ? id : districtOf(id));
}

/**
 * Lateral pivots for a subject — where to go instead, never where you already are.
 *
 * Self-reference is filtered here rather than at each call site so no surface can accidentally
 * recommend the very thing the learner is looking at, which is the one thing IMAGINE promises not
 * to do.
 */
export function pivotsFor(id: string): readonly string[] {
  const s = subject(id);
  if (!s) return [];
  const self = s.id;
  return s.pivots.filter(p => p !== self);
}

/**
 * Pick a prompt deterministically from a subject's set.
 *
 * Deterministic rather than random because the whole demo is reproducible by design — `seed.ts` uses a
 * fixed PRNG for exactly this reason, and a card that showed a different question on every render
 * would make a visual regression indistinguishable from noise.
 */
export function promptAt(id: string, n: number): Prompt | undefined {
  const s = subject(id);
  if (!s || s.prompts.length === 0) return undefined;
  // Two modulos: JS `%` keeps the sign of the dividend, so a negative index would otherwise miss.
  const i = ((n % s.prompts.length) + s.prompts.length) % s.prompts.length;
  return s.prompts[i];
}

export const RING_LABELS: Record<RingId, string> = {
  foundations: 'Foundations',
  mechanism: 'Mechanism',
  systems: 'Organ Systems',
};
