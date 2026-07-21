require("dotenv").config();

const bcrypt = require("bcrypt");
const { getDb, initDatabase } = require("./index");
const { HAPPINESS_MISSIONS } = require("../src/data/happinessMissions");
const { TEST_VARIANTS } = require("../src/data/testVariants");
const { stringifySafeJson } = require("../src/utils/safeJson");

const defaultActivities = [
  ["passeggiata", "Fare una passeggiata", "Go for a walk", "Go for a walk", "Go for a walk", "Muovi il corpo e cambia aria", "Move your body and change the atmosphere", "Move your body and change the atmosphere", "Move your body and change the atmosphere", "movement", 10, "🚶"],
  ["musica", "Ascoltare musica", "Listen to music", "Listen to music", "Listen to music", "Una canzone puo cambiare il tono della giornata", "One song can change the tone of your day", "One song can change the tone of your day", "One song can change the tone of your day", "mood", 8, "🎵"],
  ["lettura", "Leggere un libro", "Read a book", "Read a book", "Read a book", "Anche poche pagine possono rimetterti al centro", "Even a few pages can bring you back to yourself", "Even a few pages can bring you back to yourself", "Even a few pages can bring you back to yourself", "growth", 8, "📚"],
  ["chiamare-amico", "Chiamare un amico", "Call a friend", "Call a friend", "Call a friend", "Le relazioni nutrono il benessere", "Relationships nourish wellbeing", "Relationships nourish wellbeing", "Relationships nourish wellbeing", "relationships", 12, "📞"],
  ["caffe", "Bere un buon caffe", "Enjoy a good coffee", "Enjoy a good coffee", "Enjoy a good coffee", "Un piccolo rito personale che rallenta il ritmo", "A small personal ritual that slows things down", "A small personal ritual that slows things down", "A small personal ritual that slows things down", "rituals", 5, "☕"],
  ["alba", "Guardare un alba", "Watch a sunrise", "Watch a sunrise", "Watch a sunrise", "Un inizio lento e luminoso", "A slow and bright beginning", "A slow and bright beginning", "A slow and bright beginning", "nature", 9, "🌅"],
  ["tramonto", "Guardare un tramonto", "Watch a sunset", "Watch a sunset", "Watch a sunset", "Chiudi la giornata con uno sguardo largo", "End the day with a wider perspective", "End the day with a wider perspective", "End the day with a wider perspective", "nature", 9, "🌇"],
  ["complimento", "Fare un complimento sincero", "Give a sincere compliment", "Give a sincere compliment", "Give a sincere compliment", "La gentilezza torna spesso indietro", "Kindness often finds its way back", "Kindness often finds its way back", "Kindness often finds its way back", "kindness", 9, "💛"],
  ["ringraziare", "Ringraziare qualcuno", "Thank someone", "Thank someone", "Thank someone", "La gratitudine cambia il focus della giornata", "Gratitude shifts the focus of the day", "Gratitude shifts the focus of the day", "Gratitude shifts the focus of the day", "gratitude", 9, "🙏"],
  ["pianta", "Curare una pianta", "Take care of a plant", "Take care of a plant", "Take care of a plant", "Un gesto semplice che riporta attenzione", "A simple action that brings attention back", "A simple action that brings attention back", "A simple action that brings attention back", "care", 7, "🪴"],
  ["animale", "Giocare con un animale", "Play with an animal", "Play with an animal", "Play with an animal", "Contatto e leggerezza in pochi minuti", "Connection and lightness in a few minutes", "Connection and lightness in a few minutes", "Connection and lightness in a few minutes", "care", 8, "🐾"],
  ["stretching", "Fare stretching", "Do some stretching", "Do some stretching", "Do some stretching", "Riattiva il corpo senza forzarlo", "Wake your body up without pushing too hard", "Wake your body up without pushing too hard", "Wake your body up without pushing too hard", "movement", 8, "🧘"],
  ["respirare", "Respirare profondamente", "Take deep breaths", "Take deep breaths", "Take deep breaths", "Pochi respiri possono cambiare il ritmo interno", "A few breaths can change your inner pace", "A few breaths can change your inner pace", "A few breaths can change your inner pace", "calm", 7, "🌬️"],
  ["tre-cose-belle", "Scrivere tre cose belle", "Write three good things", "Write three good things", "Write three good things", "Allenati a vedere cio che ha funzionato", "Train your attention on what worked", "Train your attention on what worked", "Train your attention on what worked", "gratitude", 10, "✍️"],
  ["aiutare", "Aiutare qualcuno", "Help someone", "Help someone", "Help someone", "Anche un gesto piccolo conta", "Even a small helpful act matters", "Even a small helpful act matters", "Even a small helpful act matters", "kindness", 12, "🤝"],
  ["riordinare", "Riordinare uno spazio", "Tidy up a space", "Tidy up a space", "Tidy up a space", "L ordine esterno puo alleggerire la mente", "Outer order can lighten the mind", "Outer order can lighten the mind", "Outer order can lighten the mind", "care", 7, "🧺"],
  ["cucinare", "Preparare qualcosa di buono", "Prepare something nice", "Prepare something nice", "Prepare something nice", "Un gesto concreto che nutre", "A concrete act that nourishes", "A concrete act that nourishes", "A concrete act that nourishes", "care", 8, "🍲"],
  ["messaggio-affettuoso", "Mandare un messaggio affettuoso", "Send a caring message", "Send a caring message", "Send a caring message", "Un contatto semplice che avvicina", "A simple message that brings people closer", "A simple message that brings people closer", "A simple message that brings people closer", "relationships", 10, "💌"],
  ["pausa-senza-telefono", "Fare una pausa senza telefono", "Take a break without your phone", "Take a break without your phone", "Take a break without your phone", "Recupera attenzione e respiro", "Recover attention and breathing room", "Recover attention and breathing room", "Recover attention and breathing room", "calm", 9, "📴"],
  ["canzone-preferita", "Ascoltare una canzone preferita", "Listen to a favourite song", "Listen to a favourite song", "Listen to a favourite song", "Rientra in un energia che conosci", "Step back into a familiar energy", "Step back into a familiar energy", "Step back into a familiar energy", "mood", 7, "🎧"],
  ["piccolo-traguardo", "Raggiungere un piccolo traguardo", "Reach a small goal", "Reach a small goal", "Reach a small goal", "Segna un passo avanti reale", "Mark a real step forward", "Mark a real step forward", "Mark a real step forward", "goals", 14, "🎯"],
  ["doccia", "Fare una doccia rilassante", "Take a relaxing shower", "Take a relaxing shower", "Take a relaxing shower", "Reset corporeo e mentale", "A physical and mental reset", "A physical and mental reset", "A physical and mental reset", "care", 7, "🚿"],
  ["bere-acqua", "Bere acqua con calma", "Drink water slowly", "Drink water slowly", "Drink water slowly", "Un gesto minuscolo che riporta presenza", "A tiny act that brings you back to the present", "A tiny act that brings you back to the present", "A tiny act that brings you back to the present", "care", 5, "💧"],
  ["sorridere", "Sorridere a uno sconosciuto", "Smile at a stranger", "Smile at a stranger", "Smile at a stranger", "Un micro gesto che cambia il clima", "A tiny action that changes the atmosphere", "A tiny action that changes the atmosphere", "A tiny action that changes the atmosphere", "kindness", 6, "🙂"],
  ["natura-tempo", "Passare tempo nella natura", "Spend time in nature", "Spend time in nature", "Spend time in nature", "La natura rimette in prospettiva", "Nature brings perspective back", "Nature brings perspective back", "Nature brings perspective back", "nature", 12, "🌿"],
  ["creare", "Disegnare o creare qualcosa", "Draw or create something", "Draw or create something", "Draw or create something", "Creativita come spazio di respiro", "Creativity as a breathing space", "Creativity as a breathing space", "Creativity as a breathing space", "creativity", 9, "🎨"],
  ["ballare", "Ballare una canzone", "Dance to a song", "Dance to a song", "Dance to a song", "Muovi l energia e alleggerisci il corpo", "Move your energy and lighten your body", "Move your energy and lighten your body", "Move your energy and lighten your body", "movement", 10, "💃"],
  ["meditare", "Meditare 5 minuti", "Meditate for 5 minutes", "Meditate for 5 minutes", "Meditate for 5 minutes", "Pochi minuti fatti bene bastano", "A few good minutes are enough", "A few good minutes are enough", "A few good minutes are enough", "calm", 10, "🕊️"],
  ["gentilezza-anonima", "Fare una gentilezza anonima", "Do an anonymous kind act", "Do an anonymous kind act", "Do an anonymous kind act", "Un bene silenzioso che lascia traccia", "A quiet kind act that still leaves a mark", "A quiet kind act that still leaves a mark", "A quiet kind act that still leaves a mark", "kindness", 12, "🎁"],
  ["scrivere-diario", "Scrivere nel diario", "Write in your diary", "Write in your diary", "Write in your diary", "Metti ordine nelle emozioni e nei segnali della giornata", "Bring order to your emotions and daily signals", "Bring order to your emotions and daily signals", "Bring order to your emotions and daily signals", "reflection", 11, "📔"]
];

const defaultGestures = [
  ["Fai un complimento sincero", "Give a sincere compliment"],
  ["Chiama una persona cara", "Call someone close"],
  ["Fai una passeggiata di 15 minuti", "Take a 15 minute walk"],
  ["Ringrazia qualcuno", "Thank someone"],
  ["Ascolta una canzone che ami", "Listen to a song you love"],
  ["Scrivi tre cose belle della giornata", "Write three good things from today"],
  ["Manda un messaggio affettuoso", "Send a caring message"],
  ["Dedica 10 minuti a qualcosa che ti rilassa", "Spend 10 minutes on something relaxing"],
  ["Bevi un bicchiere d acqua con calma", "Drink a glass of water slowly"],
  ["Sorridi a una persona che incontri", "Smile at someone you meet"]
];

const defaultBadges = [
  ["primo-test", "Primo Test", "First Check", "Hai completato il tuo primo test quotidiano", "You completed your first daily check", "🙂", { entriesCount: 1 }],
  ["tre-giorni-di-consapevolezza", "Tre Giorni di Consapevolezza", "Three Days of Awareness", "Hai tenuto viva la serie per tre giorni", "You kept the streak going for three days", "🌤️", { streak: 3 }],
  ["una-settimana-di-feliciometro", "Una Settimana di Feliciometro", "One Week of HappyMeter", "Una settimana intera di check quotidiani", "A full week of daily check ins", "📆", { streak: 7 }],
  ["primo-gesto-felice", "Primo Gesto Felice", "First Happy Gesture", "Hai completato il primo gesto felice", "You completed your first happy gesture", "🤲", { gestureCount: 1 }],
  ["diario-aperto", "Diario Aperto", "Diary Opened", "Hai scritto almeno una nota vera", "You wrote at least one real note", "📔", { diaryCount: 1 }],
  ["gratitudine-crescente", "Gratitudine Crescente", "Growing Gratitude", "Cinque giornate con gratitudine alta", "Five high gratitude days", "🌱", { gratitudeDays: 5 }],
  ["energia-in-movimento", "Energia in Movimento", "Energy in Motion", "Tre giornate con movimento alto", "Three high movement days", "⚡", { highMovementDays: 3 }],
  ["campione-di-gentilezza", "Campione di Gentilezza", "Kindness Champion", "Hai collezionato tanti gesti gentili", "You collected many kind acts", "🏅", { kindnessDays: 3 }],
  ["cuore-d-oro", "Cuore d Oro", "Heart of Gold", "Hai raggiunto 700 punti", "You reached 700 points", "💛", { points: 700 }],
  ["sorriso-del-mese", "Sorriso del Mese", "Smile of the Month", "Cinque giornate sopra 80 punti", "Five days above 80 points", "🌟", { brightDays: 5 }]
];

async function ensureRecord(db, table, whereClause, whereParams, data) {
  const found = await db.get(`SELECT * FROM ${table} WHERE ${whereClause}`, whereParams);
  if (!found) {
    return db.insert(table, data);
  }
  return found;
}

async function ensureSeedData(db) {
  const adminUsername = process.env.ADMIN_INITIAL_USERNAME || "admin";
  const existingAdmin = await db.get("SELECT * FROM admin_users WHERE username = ?", [adminUsername]);
  if (!existingAdmin) {
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "HappyMeterLocalOnly2026");
    if (!initialPassword) {
      throw new Error("ADMIN_INITIAL_PASSWORD is required before creating the first production admin user");
    }
    const adminPassword = await bcrypt.hash(initialPassword, 10);
    await db.insert("admin_users", {
      username: adminUsername,
      password_hash: adminPassword
    });
  }

  for (const activity of defaultActivities) {
    await ensureRecord(db, "activities", "name_it = ?", [activity[1]], {
      name_it: activity[1],
      name_en: activity[2],
      name_de: activity[3],
      name_es: activity[4],
      description_it: activity[5],
      description_en: activity[6],
      description_de: activity[7],
      description_es: activity[8],
      category: activity[9],
      points: activity[10],
      icon: activity[11],
      active: 1
    });
  }

  for (const gesture of defaultGestures) {
    await ensureRecord(db, "happy_gestures", "text_it = ?", [gesture[0]], {
      text_it: gesture[0],
      text_en: gesture[1],
      text_de: gesture[1],
      text_es: gesture[1],
      points: 15,
      active: 1
    });
  }

  for (const badge of defaultBadges) {
    await ensureRecord(db, "badges", "code = ?", [badge[0]], {
      code: badge[0],
      name_it: badge[1],
      name_en: badge[2],
      name_de: badge[2],
      name_es: badge[2],
      description_it: badge[3],
      description_en: badge[4],
      description_de: badge[4],
      description_es: badge[4],
      icon: badge[5],
      rule_json: stringifySafeJson(badge[6]),
      active: 1
    });
  }

  for (const [index, test] of TEST_VARIANTS.entries()) {
    await ensureRecord(db, "happy_tests", "code = ?", [test.code], {
      code: test.code,
      title: test.title,
      description: test.description,
      status: "active",
      sort_order: index + 1,
      updated_at: new Date().toISOString()
    });
  }

  for (const mission of HAPPINESS_MISSIONS) {
    await ensureRecord(db, "happiness_missions", "text = ?", [mission.text], {
      text: mission.text,
      weight: mission.weight,
      status: "active",
      updated_at: new Date().toISOString()
    });
  }

  await db.run("DELETE FROM community_post_likes WHERE post_id IN (SELECT id FROM community_posts WHERE is_demo = 1)");
  await db.run("DELETE FROM community_posts WHERE is_demo = 1");

  const baseSettings = stringifySafeJson({
    siteName: "HappyMeter",
    premiumStatus: "coming-soon",
    supportEmail: "info@happymeter.it"
  });
  const existingSettings = await db.get("SELECT key FROM settings WHERE key = ?", ["base"]);
  if (existingSettings) {
    await db.run("UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?", [
      baseSettings,
      new Date().toISOString(),
      "base"
    ]);
  } else {
    await db.insert("settings", {
      key: "base",
      value_json: baseSettings
    });
  }
}

async function seed() {
  await initDatabase();
  const db = getDb();
  await ensureSeedData(db);
  console.log("HappyMeter seed complete");
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  ensureSeedData
};
