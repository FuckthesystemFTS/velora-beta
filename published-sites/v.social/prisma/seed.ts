import {
  ModerationAssignmentLevel,
  ModerationAssignmentStatus,
  ModerationCaseStatus,
  PolicyType,
  ReportReason,
  Role,
  VoteDecision,
} from "@prisma/client";

import { hashPassword } from "@/lib/auth";
import { defaultSystemConfig, policyVersion } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { sanitizeRichText } from "@/lib/sanitize";

async function createUser(
  role: Role,
  username: string,
  displayName: string,
  email: string,
  passwordHash: string,
  bio: string | null = null,
) {
  return prisma.user.upsert({
    where: { email },
    update: {
      role,
      username,
      passwordHash,
      isEmailVerified: true,
      deletedAt: null,
      isSuspended: false,
      profile: {
        upsert: {
          update: { displayName, bio },
          create: { displayName, bio },
        },
      },
    },
    create: {
      email,
      username,
      passwordHash,
      role,
      isEmailVerified: true,
      profile: { create: { displayName, bio } },
      policyAcceptances: {
        create: Object.values(PolicyType).map((policy) => ({
          policy,
          version: policyVersion,
        })),
      },
    },
    include: { profile: true },
  });
}

const communityProfiles = [
  ["giulia_verdi", "Giulia Verdi", "giulia.verdi@v.local", "Fotografia urbana e caffe.", "fotografia"],
  ["luca_ferri", "Luca Ferri", "luca.ferri@v.local", "Sport, tecnologia e note veloci.", "sport"],
  ["marta_luna", "Marta Luna", "marta.luna@v.local", "Illustrazione, libri e passeggiate.", "libri"],
  ["davide_rossi", "Davide Rossi", "davide.rossi@v.local", "Motori, weekend e amicizie vere.", "motori"],
  ["sara_nobile", "Sara Nobile", "sara.nobile@v.local", "Design, moda semplice e citta.", "design"],
  ["andrea_valli", "Andrea Valli", "andrea.valli@v.local", "Start-up, app utili e caffe lunghi.", "startup"],
  ["elena_mora", "Elena Mora", "elena.mora@v.local", "Cinema, podcast e viaggi brevi.", "cinema"],
  ["matteo_pace", "Matteo Pace", "matteo.pace@v.local", "Fitness, cucina e ironia.", "fitness"],
  ["alice_marin", "Alice Marin", "alice.marin@v.local", "Musica live e fotografie notturne.", "musica"],
  ["federico_neri", "Federico Neri", "federico.neri@v.local", "Produttivita e idee concrete.", "produttivita"],
  ["chiara_sole", "Chiara Sole", "chiara.sole@v.local", "Benessere, yoga e routine sane.", "benessere"],
  ["nicolo_resti", "Nicolo Resti", "nicolo.resti@v.local", "Gaming, stream e hardware.", "gaming"],
  ["gaia_moretti", "Gaia Moretti", "gaia.moretti@v.local", "Cibo, mercati e ricette facili.", "cibo"],
  ["marco_longo", "Marco Longo", "marco.longo@v.local", "Business locale e storie di persone.", "business"],
  ["vittoria_alba", "Vittoria Alba", "vittoria.alba@v.local", "Arte, mostre e giornate lente.", "arte"],
  ["tommaso_gori", "Tommaso Gori", "tommaso.gori@v.local", "Trail, montagna e scarpe sporche.", "outdoor"],
  ["bianca_seri", "Bianca Seri", "bianca.seri@v.local", "Scrittura, studio e luce naturale.", "scrittura"],
  ["edoardo_livi", "Edoardo Livi", "edoardo.livi@v.local", "Coding, AI e strumenti pratici.", "coding"],
  ["noemi_viva", "Noemi Viva", "noemi.viva@v.local", "Eventi, amici e serate leggere.", "eventi"],
  ["riccardo_blu", "Riccardo Blu", "riccardo.blu@v.local", "Surf, mare e allenamento.", "mare"],
  ["greta_monti", "Greta Monti", "greta.monti@v.local", "Volontariato, scuola e comunita.", "comunita"],
  ["samuele_dati", "Samuele Dati", "samuele.dati@v.local", "Dati, mappe e cose ordinate.", "dati"],
  ["teresa_pini", "Teresa Pini", "teresa.pini@v.local", "Giardinaggio e vita lenta.", "giardino"],
  ["filippo_oro", "Filippo Oro", "filippo.oro@v.local", "Investimenti prudenti e macro.", "finanza"],
  ["irene_stella", "Irene Stella", "irene.stella@v.local", "Famiglia, lavoro e equilibrio.", "equilibrio"],
] as const;

const postLines: Record<string, string[]> = {
  fotografia: [
    "Scatto semplice di oggi. Luce pulita e niente filtri pesanti.",
    "Sto scegliendo una selezione minima di foto per il weekend.",
    "Le citta all'alba restano il mio soggetto preferito.",
    "Piccoli dettagli che da vicino cambiano tutto.",
  ],
  sport: [
    "Allenamento chiuso. Meglio costanza che fuochi d'artificio.",
    "Oggi partita vista bene dall'inizio alla fine.",
    "Quando il gruppo gira bene si sente subito.",
    "Recupero, acqua e si riparte domani.",
  ],
  libri: [
    "Ho finito un romanzo breve ma molto preciso.",
    "Un angolo silenzioso e trenta pagine fatte bene.",
    "Segno qui una frase che voglio rileggere piu tardi.",
    "Sto scegliendo il prossimo libro da iniziare stasera.",
  ],
  motori: [
    "Giro corto ma pulito. Strada libera e mente in ordine.",
    "Controllo completo e poi si torna fuori.",
    "Mi piacciono le cose che funzionano senza rumore inutile.",
    "Foto veloce prima di rientrare.",
  ],
  design: [
    "Sto riducendo tutto all'essenziale e il risultato respira meglio.",
    "Palette scura, contrasti netti e tipografia pulita.",
    "Una buona interfaccia si nota per quello che non distrae.",
    "Mi salvo questo layout come riferimento.",
  ],
  startup: [
    "Settimana intensa ma le priorita sono finalmente chiare.",
    "Sto tagliando tutto quello che non porta valore reale.",
    "Poche metriche giuste valgono piu di dieci dashboard.",
    "Update breve: roadmap rimessa in ordine.",
  ],
  cinema: [
    "Film visto bene, senza telefono in mano, e cambia tutto.",
    "Mi restano addosso soprattutto le scene piu semplici.",
    "Colonna sonora precisa e mai invadente.",
    "Consiglio serale: guardatelo con calma.",
  ],
  fitness: [
    "Sessione breve ma fatta bene.",
    "Dormire meglio resta il mio vero upgrade.",
    "Niente record oggi, solo forma pulita.",
    "Anche dieci minuti contano se li fai davvero.",
  ],
  musica: [
    "Playlist aggiornata. Dentro solo pezzi che tengono il ritmo.",
    "Live piccolo ma suono pulito.",
    "Le notti buone hanno sempre un brano giusto.",
    "Sto rimettendo ordine nella libreria musicale.",
  ],
  produttivita: [
    "Tre task chiusi valgono piu di una lista infinita.",
    "Ho tolto notifiche inutili e si lavora meglio.",
    "Focus da 45 minuti, pausa breve, poi ancora.",
    "Metodo semplice: una priorita vera per volta.",
  ],
  benessere: [
    "Routine leggera ma costante.",
    "Camminata lunga e telefono in tasca.",
    "Bere acqua e staccare resta sottovalutato.",
    "Piccolo check-in: oggi piu calma del solito.",
  ],
  gaming: [
    "Build sistemata, frame stabili e via.",
    "Partita pulita, niente tilt, finalmente.",
    "Sto testando due setup e questo gira meglio.",
    "Una sera tranquilla e una lobby giusta.",
  ],
  cibo: [
    "Mercato presto, ingredienti semplici e ottimi.",
    "Cena rapida ma fatta bene.",
    "Una ricetta corta salva la settimana.",
    "Oggi solo cose fresche e leggere.",
  ],
  business: [
    "Le storie locali hanno piu valore di quanto si pensi.",
    "Sto ascoltando piu persone e decidendo piu tardi.",
    "Un'attivita solida si costruisce dal servizio, non dal rumore.",
    "Appunto veloce dalla giornata.",
  ],
  arte: [
    "Mostra piccola, dettagli forti.",
    "Mi interessa sempre di piu chi lascia spazio al silenzio.",
    "Un colore giusto cambia tutta la sala.",
    "Segno qui tre opere da rivedere.",
  ],
  outdoor: [
    "Sentiero corto, aria buona, testa libera.",
    "Le giornate semplici fuori restano le migliori.",
    "Sto preparando il prossimo giro con calma.",
    "Scarpe sporche e umore pulito.",
  ],
  scrittura: [
    "Bozza breve ma finalmente sincera.",
    "Meglio togliere una riga che aggiungerne dieci.",
    "La mattina resto piu preciso con le parole.",
    "Appunto qui una nota che non voglio perdere.",
  ],
  coding: [
    "Fix piccolo, impatto grande. E va bene cosi.",
    "Sto semplificando prima di aggiungere altro.",
    "Code review fatta con calma e meno regressioni.",
    "Oggi pulizia tecnica invece di nuove feature.",
  ],
  eventi: [
    "Serata leggera, persone giuste e zero fretta.",
    "Gli eventi piccoli spesso funzionano meglio.",
    "Foto rapida e poi telefono via.",
    "Mi segno qui la prossima data.",
  ],
  mare: [
    "Acqua fredda ma energia giusta.",
    "Mattina presto e spiaggia quasi vuota.",
    "Allenarsi vicino al mare cambia il passo.",
    "Giornata essenziale e pulita.",
  ],
  comunita: [
    "Le cose utili si fanno meglio insieme.",
    "Oggi incontro breve ma molto concreto.",
    "Quando il quartiere si muove, si sente.",
    "Porto qui una nota positiva della giornata.",
  ],
  dati: [
    "Una tabella ordinata risolve meta del problema.",
    "Meno grafici, piu chiarezza.",
    "Sto pulendo i dati prima di trarre conclusioni.",
    "Appunto rapido dal lavoro di oggi.",
  ],
  giardino: [
    "Piccole cure, risultato enorme nel tempo.",
    "Stamattina solo terra, acqua e silenzio.",
    "Le piante obbligano a rallentare nel modo giusto.",
    "Nuovi germogli, buon segno.",
  ],
  finanza: [
    "Meno mosse, piu disciplina.",
    "Sto guardando i numeri con piu calma.",
    "La gestione del rischio viene prima di tutto.",
    "Note brevi dalla settimana.",
  ],
  equilibrio: [
    "Giornata piena ma tenuta bene.",
    "Sto difendendo gli spazi buoni della giornata.",
    "Piccoli rituali aiutano piu di tante promesse.",
    "Chiudo qui con una nota serena.",
  ],
};

async function main() {
  await prisma.systemConfig.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", ...defaultSystemConfig },
  });

  const passwordHash = await hashPassword(process.env.SEED_DEFAULT_PASSWORD ?? "ChangeMe123!");
  const users = [];

  users.push(await createUser(Role.SUPERADMIN, "superadmin", "Super Admin", "superadmin@v.local", passwordHash));
  users.push(await createUser(Role.ADMIN, "admin1", "Admin One", "admin1@v.local", passwordHash));
  users.push(await createUser(Role.ADMIN, "admin2", "Admin Two", "admin2@v.local", passwordHash));

  for (let index = 1; index <= 3; index += 1) {
    users.push(await createUser(Role.MODERATOR, `moderator${index}`, `Moderator ${index}`, `moderator${index}@v.local`, passwordHash));
  }
  for (let index = 1; index <= 10; index += 1) {
    users.push(await createUser(Role.VERIFIED_USER, `verified${index}`, `Verified ${index}`, `verified${index}@v.local`, passwordHash));
  }
  for (let index = 1; index <= 30; index += 1) {
    users.push(await createUser(Role.USER, `user${index}`, `User ${index}`, `user${index}@v.local`, passwordHash));
  }

  const communityUsers = [];
  for (const [username, displayName, email, bio] of communityProfiles) {
    communityUsers.push(await createUser(Role.USER, username, displayName, email, passwordHash, bio));
  }

  for (let index = 0; index < communityUsers.length; index += 1) {
    const user = communityUsers[index];
    for (let offset = 1; offset <= 3; offset += 1) {
      const followed = communityUsers[(index + offset) % communityUsers.length];
      if (followed.id !== user.id) {
        await prisma.follow.upsert({
          where: {
            followerId_followedId: {
              followerId: user.id,
              followedId: followed.id,
            },
          },
          update: {},
          create: {
            followerId: user.id,
            followedId: followed.id,
          },
        });
      }
    }
  }

  const communityPosts = [];
  for (let index = 0; index < communityProfiles.length; index += 1) {
    const [username, , , , topic] = communityProfiles[index];
    const author = communityUsers.find((user) => user.username === username)!;
    for (const content of postLines[topic].slice(0, 4)) {
      const post =
        (await prisma.post.findFirst({
          where: {
            authorId: author.id,
            content,
            deletedAt: null,
          },
        })) ??
        (await prisma.post.create({
          data: {
            authorId: author.id,
            content,
            sanitizedContent: sanitizeRichText(content),
            hashtags: [`#${topic}`],
          },
        }));
      communityPosts.push(post);
    }
  }

  for (let index = 0; index < communityPosts.length; index += 1) {
    const post = communityPosts[index];
    const firstLiker = communityUsers[(index + 1) % communityUsers.length];
    const secondLiker = communityUsers[(index + 4) % communityUsers.length];
    const commenter = communityUsers[(index + 2) % communityUsers.length];

    for (const liker of [firstLiker, secondLiker]) {
      if (liker.id !== post.authorId) {
        await prisma.postLike.upsert({
          where: {
            userId_postId: {
              userId: liker.id,
              postId: post.id,
            },
          },
          update: {},
          create: {
            postId: post.id,
            userId: liker.id,
          },
        });
      }
    }

    if (commenter.id !== post.authorId && index % 2 === 0) {
      const commentText = index % 4 === 0 ? "Pulito. Si legge bene e arriva subito." : "Bel contenuto, semplice e chiaro.";
      const existingComment = await prisma.comment.findFirst({
        where: {
          postId: post.id,
          authorId: commenter.id,
          content: commentText,
        },
      });
      if (!existingComment) {
        await prisma.comment.create({
          data: {
            postId: post.id,
            authorId: commenter.id,
            content: commentText,
            sanitizedContent: sanitizeRichText(commentText),
          },
        });
      }
    }
  }

  const author = users.find((user) => user.role === Role.USER)!;
  const reporter = users.find((user) => user.role === Role.USER && user.id !== author.id)!;

  const flaggedPost =
    (await prisma.post.findFirst({
      where: {
        authorId: author.id,
        content: "Contenuto demo per verifica moderazione.",
        deletedAt: null,
      },
    })) ??
    (await prisma.post.create({
      data: {
        authorId: author.id,
        content: "Contenuto demo per verifica moderazione.",
        sanitizedContent: sanitizeRichText("Contenuto demo per verifica moderazione."),
        hashtags: ["#verifica"],
      },
    }));

  const moderationCase =
    (await prisma.moderationCase.findFirst({
      where: { postId: flaggedPost.id },
    })) ??
    (await prisma.moderationCase.create({
      data: {
        postId: flaggedPost.id,
        authorId: author.id,
        reporterId: reporter.id,
        status: ModerationCaseStatus.LEVEL1_PENDING,
        level: ModerationAssignmentLevel.LEVEL1,
      },
    }));

  const existingReport = await prisma.report.findFirst({
    where: {
      reporterId: reporter.id,
      postId: flaggedPost.id,
      moderationCaseId: moderationCase.id,
    },
  });
  if (!existingReport) {
    await prisma.report.create({
      data: {
        reporterId: reporter.id,
        postId: flaggedPost.id,
        reason: ReportReason.OTHER,
        reasonText: "Segnalazione demo.",
        moderationCaseId: moderationCase.id,
      },
    });
  }

  const jury = users.filter((item) => item.role === Role.USER).slice(0, 10);
  for (const juror of jury) {
    const assignment =
      (await prisma.moderationAssignment.findFirst({
        where: {
          moderationCaseId: moderationCase.id,
          userId: juror.id,
          level: ModerationAssignmentLevel.LEVEL1,
        },
      })) ??
      (await prisma.moderationAssignment.create({
        data: {
          moderationCaseId: moderationCase.id,
          userId: juror.id,
          level: ModerationAssignmentLevel.LEVEL1,
          status: ModerationAssignmentStatus.VOTED,
          votedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      }));

    const existingVote = await prisma.moderationVote.findFirst({
      where: {
        moderationCaseId: moderationCase.id,
        assignmentId: assignment.id,
        voterId: juror.id,
      },
    });

    if (!existingVote) {
      await prisma.moderationVote.create({
        data: {
          moderationCaseId: moderationCase.id,
          assignmentId: assignment.id,
          voterId: juror.id,
          level: ModerationAssignmentLevel.LEVEL1,
          decision: jury.indexOf(juror) < 6 ? VoteDecision.REMOVE : VoteDecision.KEEP,
        },
      });
    }
  }

  console.log("Seed completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
