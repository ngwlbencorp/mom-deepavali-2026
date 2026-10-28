// All mini-site wording (English). Other languages live in js/lang/<code>.js and only need to
// provide the text: anything they leave out falls back to the English here. Answers, flags and
// scoring are defined once, below, and are never translated.
// Scenarios follow public MOM, ScamShield and Police guidance (checked 26 Oct 2026; sources in
// README "Content sources"). Mock messages are fictional and always labelled EXAMPLE.

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
    home: "Home",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    exitQuiz: "Exit quiz",
    exitConfirm: "Leave the quiz? Your answers so far will be lost.",
    closeReview: "Close review",
    learnTitle: "Learn about scams",
    learnSub: "5 short stories · 2 min",
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
    notSaved: "Not saved yet (no connection). An officer can still scan this QR code.",
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
  // flags lighting up one by one, then "What to do".
  learn: [
    {
      title: "Fake MOM officer",
      tagline: "Scammers pretend to be MOM or the Police.",
      chat: { channel: "Phone call", from: "Unknown number", lines: [
        "Hello, I am an officer from MOM. Your work permit has a problem.",
        "Pay $500 now or you will be sent home!",
        "Install this app from my link so I can help you.",
        "Now I will transfer your call to the Police."
      ] },
      flags: [
        { line: 1, label: "Asks you to pay now" },
        { line: 2, label: "App from outside the app store" },
        { line: 3, label: "Transfers your call to the Police" }
      ],
      todo: [
        "MOM may call you about your work. But MOM will never ask you to transfer money, give your bank login, or install apps from outside the app store.",
        "MOM will never transfer your call to the Police. Unsure? Hang up."
      ]
    },
    {
      title: "Fake festive deal",
      tagline: "Too-good deals that make you install an app.",
      chat: { channel: "Advertisement", from: "Deepavali Gold Sale", lines: [
        "Deepavali Mega Sale! Gold 80% off!",
        "Download our app here: deepavali-gold.example/app",
        "Only 1 hour left!"
      ] },
      flags: [
        { line: 1, label: "App link outside the app store" }
      ],
      todo: [
        "Only install apps from the official app store.",
        "Fake ads can make you install apps that steal your money."
      ]
    },
    {
      title: "Easy money (scam mule)",
      tagline: "Paying you to use your bank account.",
      chat: { channel: "Chat message", from: "+65 8XXX XXXX", lines: [
        "Want easy money? $300 a week, no work!",
        "Just lend me your bank account, SIM card or Singpass."
      ] },
      flags: [
        { line: 0, label: "Easy money" },
        { line: 1, label: "Wants your account, SIM or Singpass" }
      ],
      todo: [
        "Never sell, lend or give away your bank account, SIM card or Singpass.",
        "It is a crime. You can be fined, jailed or caned."
      ]
    },
    {
      title: "Fake job or work permit",
      tagline: "Official-looking offers that ask for money.",
      chat: { channel: "Chat message", from: "SG Jobs Agent", lines: [
        "Your Singapore work permit is approved!",
        "Send $800 today to confirm your job."
      ], attachment: "WORK PERMIT APPROVAL.pdf" },
      flags: [
        { line: 0, label: "Looks official" },
        { line: 1, label: "Pay today to confirm" }
      ],
      todo: [
        "Check job offers through official channels, like MOM's website.",
        "Licensed agencies can charge fees, but check first. Call 1799 if unsure."
      ]
    },
    {
      title: "Secret codes (OTP)",
      tagline: "Scammers ask for the code sent to your phone.",
      chat: { channel: "SMS", from: "+65 9XXX XXXX", lines: [
        "Sorry, I sent a code to your phone by mistake.",
        "Please send me the 6-digit code. Quick!"
      ] },
      flags: [
        { line: 1, label: "Asks for your code + rushes you" }
      ],
      todo: [
        "Never share codes (OTP) with anyone.",
        "Remember ACT: ADD the ScamShield app, CHECK with 1799, TELL family and friends."
      ]
    }
  ],

  // Quiz: scenarios differ from the presentation's questions. Right answers are shown only at the
  // end, in "Review answers". Points: spot = 1, each sort card = 1, reply = 1, pick = 1.
  quiz: [
    {
      type: "spot",
      title: "Spot the red flags",
      // Red flags, each an official rule: sender is not "gov.sg"; mom-sg.org is a fake address MOM
      // itself publishes; government agencies do not ask for banking details by SMS (ScamShield).
      // The penalty is deliberately NOT a red flag: the topic alone does not prove a scam.
      msg: { channel: "SMS", from: "MOM-ALERT", fromFlag: true, bubbles: [
        [{ t: "Dear worker," }, { t: "you have an unpaid work permit penalty of $350." }],
        [{ t: "Pay at" }, { t: "mom-sg.org/pay", flag: true }, { t: "or reply with your bank login.", flag: true }]
      ] },
      explain: "Government SMSes come from \"gov.sg\". Real MOM links contain \".mom.gov.sg\". Government agencies do not ask for bank details by SMS. If unsure, call 1799."
    },
    {
      type: "sort",
      title: "Scam or safe?",
      cards: [
        { from: "Your employer", text: "Please buy rice on the way home. Thank you!", scam: false,
          why: "A normal message from someone you know, with no money or codes asked." },
        { from: "Unknown number", text: "Your bank account is locked. Reply with the OTP we just sent you.", scam: true,
          why: "Never share your OTP (the secret code sent to your phone) with anyone." },
        { from: "New contact", text: "Lend me your bank card for one week. I give you $300.", scam: true,
          why: "This is a scam mule offer. Lending your bank card is a crime." },
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
        "No. I never share codes. I will call 1799 to check.",
        "Send me your photo first, then I will send it."
      ],
      answer: 1,
      explain: "Never share your OTP (the secret code sent to your phone) with anyone, even family. If unsure, call 1799."
    },
    {
      type: "pick",
      title: "Pick the safe way",
      prompt: "You want to install a Deepavali sale app. Where should you get it?",
      options: [
        { icon: "store", label: "The official app store on your phone" },
        { icon: "chat", label: "A link sent in a chat message" },
        { icon: "ad", label: "A link in an online advert" }
      ],
      answer: 0,
      explain: "Only install apps from the official app store. Apps from links can steal your bank details."
    },
    {
      type: "spot",
      title: "Spot the red flags",
      // Red flags, each an official rule: it is illegal to demand money from a worker to keep their
      // job (MOM); wponlinemomgov.sg.com is a fake address MOM publishes; never share your Singpass
      // password.
      msg: { channel: "Chat message", from: "Job Agent", bubbles: [
        [{ t: "Your employer wants to cancel your work permit." }],
        [{ t: "Pay me $500 to keep your job.", flag: true }],
        [{ t: "Check your permit at" }, { t: "wponlinemomgov.sg.com", flag: true }, { t: "and send me your Singpass password.", flag: true }]
      ] },
      explain: "It is illegal for anyone to ask you for money to keep your job. Real MOM links contain \".mom.gov.sg\". Never share your Singpass password."
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
    intro: "Use this for MWs without a phone, or whose QR code does not work. Ask each question and mark their reply.",
    questions: [
      { q: "Someone says they are from MOM and asks you to transfer money. Should you do it?", answer: "No" },
      { q: "True or false: it is safe to tell a caller the secret code (OTP) sent to your phone.", answer: "False" },
      { q: "What number can you call to check if something is a scam?", answer: "1799" }
    ]
  }
};

// The admin page reads SCAM_CONTENT.manual.
window.SCAM_CONTENT = window.SCAM_TEXT.en;
