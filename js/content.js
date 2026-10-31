// All mini-site wording (English). Other languages live in js/lang/<code>.js and only need to
// provide the text: anything they leave out falls back to the English here. Answers, flags and
// scoring are defined once, below, and are never translated.
// Every rule taught here comes from a public MOM, ScamShield, Police or GovTech page (checked
// 28 Oct 2026). SOURCES.md maps each story, flag and quiz answer to its source and quote.
// Mock messages are fictional and always labelled EXAMPLE. Each story links to one official video
// on YouTube (linking and embedding are allowed by YouTube's terms; the government sites' own
// images may not be reproduced without permission, so none are copied here).
// video: { id, by, lang }: lang gives a version subtitled in that language, where one exists.
// Writing style, to keep translation simple: short sentences, one idea each, everyday words,
// and the same word for the same thing everywhere (e.g. "OTP", "app store", "bank login").

window.SCAM_LANGS = [{ code: 'en', name: 'English' }];
window.SCAM_TEXT = window.SCAM_TEXT || {};

window.SCAM_TEXT.en = {
  event: {
    greeting: "Happy Deepavali!",
    title: "Stay safe from scams",
    intro: "Learn the tricks scammers use, then take the quiz.",
    souvenirNote: "Get all answers correct and show your QR code to an MOM officer for a souvenir. First 500 only!",
    helpline: "1799",
    helplineName: "ScamShield Helpline"
  },

  ui: {
    language: "Language",
    csr: "A GovTech Corporate Social Responsibility initiative",
    legal: "By using this site, you agree to the {terms} and {privacy}.",
    terms: "Terms of Use",
    privacy: "Privacy Statement",
    // shown only in a translated language: in the home footer, and under the language menu
    translated: "Translated with AI and checked by machine. If anything is unclear, switch to English or call 1799.",
    translations: "Translations are made with AI. English is the reference.",
    home: "Home",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    exitQuiz: "Exit quiz",
    exitConfirm: "Leave the quiz? Your answers so far will be lost.",
    closeReview: "Close review",
    learnTitle: "Learn about scams",
    learnSub: "6 short stories · 3 min",
    quizTitle: "Quiz for a souvenir",
    quizTitleAfter: "Take the quiz",
    quizSub: "6 challenges · 3 min",
    showQr: "Show my QR code",
    showResult: "Show my result",
    left: "🎁 {n} souvenirs left",
    soldOut: "All souvenirs have been given out. Thank you for taking part!",
    afterFull: "Great job! You know how to spot scams.",
    afterPartial: "Review the answers, then try again.",
    unsure: "Unsure? Call",
    example: "EXAMPLE · NOT REAL",
    whatToDo: "What to do",
    toQuiz: "Take the quiz",
    watch: "Watch the official video",
    spotPrompt: "Tap the {n} red flags",
    selected: "{k} of {n} chosen",
    scam: "Scam",
    safe: "Safe",
    card: "Message {i} of {n}",
    step: "{i} of {n}",
    saving: "Saving your result…",
    allCorrect: "All correct!",
    allCorrectMsg: "Show this QR code to an MOM officer for your souvenir.",
    earnedBefore: "You got all correct before, so your QR code is still valid.",
    partial: "{s} of {t} correct",
    partialMsg: "Review the answers, then try again for a souvenir.",
    review: "Review answers",
    tryAgain: "Try again",
    backToResult: "Back to my QR code",
    saved: "Result saved ✓",
    notSaved: "Not saved yet (no connection). Your QR code will show once it is saved.",
    notSavedAfter: "Not saved yet (no connection).",
    retry: "Retry saving",
    yourAnswer: "Your answer",
    rightAnswer: "Right answer",
    correct: "Correct",
    wrong: "Not correct",
    codeLabel: "Code",
    attempt: "Attempt"
  },

  // Learn: one story per scam type in the deck. Each story: an animated example message, its red
  // flags lighting up one by one, then "What to do". chat.app sets how the message looks: "sms",
  // "call" or "ad"; anything else looks like a chat app. Fake SMS senders show as "Likely-SCAM",
  // as Singapore phones label SMS from Sender IDs not registered with the SMS Sender ID Registry.
  learn: [
    {
      title: "Fake MOM officer",
      tagline: "Scammers pretend to be MOM or the Police.",
      chat: { app: "call", channel: "Phone call", from: "Unknown number", lines: [
        "Hello, I am from MOM. There is a problem with your work permit.",
        "Transfer $500 now, or you will be sent home!",
        "Install this app from my link so I can help you.",
        "Now I will transfer your call to the Police."
      ] },
      flags: [
        { line: 1, label: "Asks you to transfer money" },
        { line: 2, label: "App from a link, not the app store" },
        { line: 3, label: "Transfers your call to the Police" }
      ],
      todo: [
        "MOM may call you about your work. But MOM will never ask you to transfer money or give your bank login.",
        "MOM will never ask you to install an app from a link, or transfer your call to the Police. Unsure? Hang up."
      ],
      video: { id: "DtfmVQSBqsE", by: "Singapore Police Force" }
    },
    {
      title: "Fake festive deal",
      tagline: "Too-good deals that make you install an app.",
      chat: { app: "ad", channel: "Advertisement", from: "Deepavali Gold Sale", lines: [
        "Deepavali sale! Gold 80% off!",
        "Download our app here: deepavali-gold.example/app",
        "Only 1 hour left!"
      ] },
      flags: [
        { line: 0, label: "Price is too good to be true" },
        { line: 1, label: "App from a link, not the app store" },
        { line: 2, label: "Rushes you" }
      ],
      todo: [
        "Only install apps from the official app store on your phone.",
        "Fake apps can steal money from your bank account."
      ],
      video: { id: "j9-EMJlNkao", by: "MOM" }
    },
    {
      title: "Easy money (scam mule)",
      tagline: "Paying you to use your bank account.",
      chat: { channel: "Chat message", from: "+65 8XXX XXXX", lines: [
        "Want easy money? $300 a week, no work!",
        "Just let me use your bank account, SIM card or Singpass."
      ] },
      flags: [
        { line: 0, label: "Money for no work" },
        { line: 1, label: "Wants your bank account, SIM card or Singpass" }
      ],
      todo: [
        "Never sell, lend or give away your bank account, SIM card or Singpass.",
        "This is a crime. You can be fined, jailed or caned."
      ],
      video: { id: "ytBKJNpYX3M", by: "Singapore Police Force" }
    },
    {
      title: "Fake job or work permit",
      tagline: "Fake approval letters that ask for money.",
      chat: { channel: "Chat message", from: "SG Jobs Agent", lines: [
        "Good news! Your work permit is approved.",
        "Send $800 today to confirm your job.",
        "We are a licensed agency. Licence no. 99X9999."
      ], attachment: "IPA LETTER.pdf" },
      flags: [
        { line: 1, label: "Asks you to pay first" },
        { line: 2, label: "A licence number does not prove it is real" }
      ],
      todo: [
        "Check your work pass yourself on MOM's website: \"Check work pass and application status\". No login needed.",
        "Asking you to pay first is a common job scam sign. No one can make you pay to keep your job: that is illegal."
      ],
      video: { id: "l6GoxFEUB4Y", by: "NCPC" }
    },
    {
      title: "Secret codes (OTP)",
      tagline: "Scammers ask for the code sent to your phone.",
      chat: { app: "sms", channel: "SMS", from: "+65 9XXX XXXX", lines: [
        "Sorry, I sent a code to your phone by mistake.",
        "Please send me the 6-digit code. Quick!"
      ] },
      flags: [
        { line: 1, label: "Asks for your OTP and rushes you" }
      ],
      todo: [
        "Never share your OTP (the code sent to your phone) or your Singpass password with anyone.",
        "Someone says they changed their number? Call their old number to check."
      ],
      video: { id: "_2e1GCLl7Cs", by: "MOM", lang: { hi: "KTO5GpIIjSc", my: "iK6B5pRFu_c", ta: "uruQE3-l6AU" } }
    },
    {
      // Moved here from the presentation (content v2). www.mom.gov.sg.official.com.net is one of the
      // fakes MOM itself publishes (M1); the quiz's fake addresses are deliberately not used here.
      title: "Fake MOM message",
      tagline: "Check who sent it, and where the link goes.",
      chat: { app: "sms", channel: "SMS", from: "Likely-SCAM", lines: [
        "MOM: your work permit will expire soon.",
        "Renew it now: www.mom.gov.sg.official.com.net"
      ] },
      flags: [
        { line: 1, label: "Fake website: it does not end with .mom.gov.sg" }
      ],
      todo: [
        "Government SMS come from the sender \"gov.sg\".",
        "Real MOM websites end with \".mom.gov.sg\". Look at the website name, before the first \"/\"."
      ],
      video: { id: "SawQL3w8rSc", by: "CSA" }
    }
  ],

  // Closing screen after the last story (as on the presentation's ACT slide). ADD, CHECK and TELL stay in English.
  act: {
    title: "Remember ACT",
    items: ["ADD the ScamShield app", "CHECK with 1799", "TELL family and friends"]
  },

  // Quiz: scenarios differ from the presentation's questions. Right answers are shown only at the
  // end, in "Review answers". Points: spot = 1, each sort card = 1, reply = 1, pick = 1.
  quiz: [
    {
      type: "spot",
      title: "Spot the red flags",
      // Red flags, each an official rule: government SMSes come from "gov.sg" (MOM, ScamShield), and
      // the "Likely-SCAM" label means an unregistered sender (IMDA);
      // mom-sg.org is a fake site MOM itself lists; government agencies do not ask for banking
      // details by SMS (ScamShield). The greeting and the fine are NOT red flags: no official
      // rule says so, and the topic alone does not prove a scam.
      msg: { app: "sms", channel: "SMS", from: "Likely-SCAM", fromFlag: true, bubbles: [
        [{ t: "Dear worker," }, { t: "you have an unpaid work permit fine of $350." }],
        [{ t: "Pay at" }, { t: "mom-sg.org/pay", flag: true }, { t: "or reply with your bank login.", flag: true }]
      ] },
      explain: "Government SMSes come from \"gov.sg\". Real MOM addresses end with \".mom.gov.sg\". The Government never asks for your bank login by SMS. Unsure? Call 1799."
    },
    {
      type: "sort",
      title: "Scam or safe?",
      cards: [
        { from: "Your employer", text: "Please buy rice on the way home. Thank you!", scam: false,
          why: "A normal message from someone you know, with no money or codes asked." },
        { from: "Unknown number", text: "Your bank account is locked. Reply with the OTP we just sent you.", scam: true,
          why: "Never share your OTP (the code sent to your phone) with anyone, even if they say they are your bank." },
        { from: "New contact", text: "Lend me your bank card for one week. I will pay you $300.", scam: true,
          why: "This is a scam mule offer. Letting others use your bank card is a crime." },
        { from: "Your friend", text: "Happy Deepavali! See you at the event on Sunday.", scam: false,
          why: "A normal greeting from a friend, with nothing asked." }
      ]
    },
    {
      type: "reply",
      title: "What would you reply?",
      chat: { from: "\"Cousin\" (new number)", lines: [
        "Hi, it's your cousin. I changed my number.",
        "I sent a 6-digit code to your phone by mistake. Can you send it to me? Urgent!"
      ] },
      options: [
        "OK, here is the code: 482915",
        "No. I never share codes. I will call your old number.",
        "Send me your photo first, then I will send it."
      ],
      answer: 1,
      explain: "Never share your OTP, even with family. If someone says they changed their number, call their old number to check."
    },
    {
      type: "pick",
      title: "Pick the safe way",
      prompt: "You want a shopping app for Deepavali deals. Where should you get it?",
      options: [
        { icon: "store", label: "The official app store on your phone" },
        { icon: "chat", label: "A link sent in a chat message" },
        { icon: "ad", label: "A link in an online advert" }
      ],
      answer: 0,
      explain: "Only install apps from the official app store on your phone. Apps from links can steal your money."
    },
    {
      type: "spot",
      title: "Spot the red flags",
      // Red flags, each an official rule: it is illegal to demand money from a worker to keep their
      // job (MOM); wponlinemomgov.sg.com is a fake site MOM lists (it ends with ".sg.com", not
      // ".mom.gov.sg"); never share your Singpass password (GovTech, SPF).
      msg: { channel: "Chat message", from: "Job Agent", bubbles: [
        [{ t: "Your employer wants to cancel your work permit." }],
        [{ t: "Pay me $500 to keep your job.", flag: true }],
        [{ t: "Check your permit at" }, { t: "wponlinemomgov.sg.com", flag: true }, { t: "and send me your Singpass password.", flag: true }]
      ] },
      explain: "It is illegal to make you pay to keep your job. Real MOM addresses end with \".mom.gov.sg\". Never share your Singpass password."
    },
    {
      type: "reply",
      title: "What would you reply?",
      chat: { from: "Unknown number", lines: [
        "Easy money! Earn $200 every week.",
        "Just let me use your bank account and Singpass."
      ] },
      options: [
        "OK, how do I start?",
        "Can you pay me $400 instead?",
        "No. This is a crime. I will report it."
      ],
      answer: 2,
      explain: "Letting others use your bank account or Singpass makes you a scam mule. It is a crime. Say no and report it."
    }
  ],

  feedback: {
    title: "One last thing",
    csatQuestion: "How happy are you with today's event?",
    csatLabels: ["Very unhappy", "Unhappy", "Okay", "Happy", "Very happy"],
    learnedQuestion: "Did you learn something new about scams?",
    learnedOptions: [
      { code: "Y", label: "Yes" },
      { code: "S", label: "A little" },
      { code: "N", label: "No" }
    ],
    submit: "See my result"
  },

  // Admin "Manual input" page (officers only, English): for MWs without a phone, or whose code does
  // not work. The officer asks each question aloud and marks the reply. All correct = souvenir.
  manual: {
    intro: "For MWs with no phone or working QR code. Ask each question, explain wrong answers, record once they understand.",
    questions: [
      { q: "Someone says they are from MOM and asks you to transfer money. Should you do it?", answer: "No" },
      { q: "True or false: it is safe to tell a caller the secret code (OTP) sent to your phone.", answer: "False" },
      { q: "What number can you call to check if something is a scam?", answer: "1799" }
    ]
  }
};

// The admin page reads SCAM_CONTENT.manual.
window.SCAM_CONTENT = window.SCAM_TEXT.en;
