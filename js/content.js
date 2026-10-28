// All wording for the mini-site lives here so it can be reviewed and edited
// without touching app logic. Items marked VERIFY must be checked against the
// latest official source before the event.

window.SCAM_CONTENT = {
  event: {
    greeting: "Happy Deepavali!",
    title: "Stay safe from scams",
    intro: "Scammers use festivals, jobs and fake officers to trick you into sending money. Answer 8 quick questions to learn how to spot their tricks.",
    meta: "8 questions · about 3 minutes",
    souvenirNote: "Get all answers correct and show your QR code to an MOM officer for a souvenir. Only for the first 500 correct answers!",
    staffNote: "Look for MOM officers wearing the MOM badge at both sides of the hall.",
    helpline: "1799",
    helplineName: "ScamShield Helpline"
  },

  links: [
    { label: "MOM: Staying safe from scams", url: "https://www.mom.gov.sg/passes-and-permits/work-permit-for-foreign-domestic-worker/publications-and-resources/staying-safe-from-scams" },
    { label: "ScamShield: Don't be a scam mule", url: "https://www.scamshield.gov.sg/i-want-protection-from-scams/scam-mules/" }
  ],

  // type: "single" (tap one answer) or "multi" (select all that apply, then check)
  // answer: index (single) or array of indexes (multi)
  // example: optional fictional message shown as a phone mock-up, always labelled EXAMPLE
  questions: [
    {
      // Slide 1. VERIFY: confirm the latest SPF figure for self-effected transfers.
      topic: "The scammer needs you to press SEND",
      question: "In scam cases, how often do victims send the money themselves?",
      type: "single",
      options: ["2 in 10 victims", "4 in 10 victims", "6 in 10 victims", "8 in 10 victims"],
      answer: 3,
      explain: "About 8 in 10 victims sent the money themselves. Scammers do not need to hack you: they scare, rush or excite you until you press SEND. Anyone can be targeted."
    },
    {
      // Slide 2
      topic: "Spot the trick: Fake MOM officer",
      example: {
        channel: "Phone call",
        from: "Unknown number",
        lines: [
          "Hello, I am an officer from MOM.",
          "Your work permit has a problem. Pay now or you will be sent home!",
          "Download this app so I can help you. Now I will transfer you to the Police."
        ]
      },
      question: "Which of these would MOM NEVER ask you to do? Select all that apply.",
      type: "multi",
      options: [
        "Transfer money to a bank account",
        "Give your bank login details",
        "Install an app from a link",
        "Transfer your call to the Police",
        "Check information yourself on MOM's official website"
      ],
      answer: [0, 1, 2, 3],
      explain: "MOM will never ask you to transfer money, give your bank login, install an app from a link, or transfer your call to the Police. If unsure, hang up and call 1799."
    },
    {
      // Slide 3
      topic: "Spot the trick: Fake festive offer",
      example: {
        channel: "Advertisement",
        from: "Deepavali Deals",
        lines: [
          "Special Deepavali deal! 90% off gold jewellery!",
          "Install our app to claim: deepavali-deals.example/app",
          "Offer ends in 1 hour!"
        ]
      },
      question: "What is the safest thing to do?",
      type: "single",
      options: [
        "Install the app quickly before the deal ends",
        "Only install apps from official app stores (Google Play Store or Apple App Store)",
        "Send the link to friends so they can get the deal too",
        "Install the app, then delete it after buying"
      ],
      answer: 1,
      explain: "Apps from links outside the official app stores can contain malware that steals your bank details or takes control of your phone. A deal that rushes you is a warning sign."
    },
    {
      // Slide 4. VERIFY: penalties wording against the ScamShield scam mule page.
      topic: "Spot the trick: Easy money",
      example: {
        channel: "WhatsApp",
        from: "+65 8XXX XXXX",
        lines: [
          "Easy money! Earn $500 a week, no work needed.",
          "Just let us use your bank account, SIM card or Singpass."
        ]
      },
      question: "Letting others use your bank account, SIM card or Singpass can be a crime. What are the penalties?",
      type: "single",
      options: ["Fines", "Jail", "Caning", "All of the above"],
      answer: 3,
      explain: "Never lend or sell your bank account, SIM card or Singpass. Becoming a scam mule can be a criminal offence, and penalties can include fines, jail and caning.",
      link: 1
    },
    {
      // Slide 5
      topic: "Fake job or work permit offer",
      example: {
        channel: "WhatsApp",
        from: "SG Jobs Agent",
        lines: [
          "Congratulations! Your Singapore work permit is approved.",
          "Send $800 within 24 hours to confirm your job."
        ],
        attachment: "WORK PERMIT APPROVAL.pdf"
      },
      question: "True or false: every job-related message, document or payment is a scam.",
      type: "single",
      options: ["True", "False"],
      answer: 1,
      explain: "False. Some payments are real: for example, licensed employment agencies can charge fees. But a message or document that looks official is not always genuine. Always verify the job offer, the sender and any payment request through official channels."
    },
    {
      // Slide 5 follow-up
      topic: "Fake job or work permit offer",
      question: "How can you check if a job offer or payment request is real?",
      type: "single",
      options: [
        "It has an official-looking logo and stamp",
        "Check through official channels, e.g. confirm the employment agency is licensed on MOM's website, or call 1799",
        "The sender replies quickly and is very friendly",
        "Pay a small amount first to test"
      ],
      answer: 1,
      explain: "Logos, stamps and friendly replies are easy to fake. Check through official channels before you pay or share anything.",
      link: 0
    },
    {
      // Slide 6
      topic: "Remember: ACT",
      question: "What does ACT stand for?",
      type: "single",
      options: [
        "ADD protection, CHECK first, TELL someone",
        "ANSWER, CALL, TRANSFER",
        "ACT fast, CLICK the link, TRUST the caller",
        "ACCEPT, CHECK, TRANSFER"
      ],
      answer: 0,
      explain: "ADD protection, such as the ScamShield app and your phone's security features. CHECK suspicious messages with official sources. TELL the authorities, family and friends about scams."
    },
    {
      // Closing: secret codes and 1799
      topic: "Never share secret codes",
      example: {
        channel: "SMS",
        from: "+65 9XXX XXXX",
        lines: [
          "Sorry, I sent a code to your phone by mistake.",
          "Please tell me the 6-digit code quickly!"
        ]
      },
      question: "You are not sure if this is a scam. What should you do?",
      type: "single",
      options: [
        "Share the code: it is only a number",
        "Do not share the code. Call 1799 (ScamShield Helpline) to check",
        "Call back the number that sent the message",
        "Ask the sender if they are real"
      ],
      answer: 1,
      explain: "Never share secret codes (OTPs). STOP suspicious requests, CHECK with 1799, and only use official app stores."
    }
  ],

  // Admin "Manual input" page: for MWs without a phone, or whose code does not work.
  // The officer asks each question aloud and marks the MW's reply. All correct = souvenir.
  manual: {
    intro: "Use this for MWs without a phone, or whose QR code does not work. Ask each question and mark their reply.",
    questions: [
      { q: "Someone says they are from MOM and asks you to transfer money. Should you do it?", answer: "No" },
      { q: "True or false: it is safe to tell a caller the secret code (OTP) sent to your phone.", answer: "False" },
      { q: "What number can you call to check if something is a scam?", answer: "1799" }
    ]
  },

  feedback: {
    title: "One last thing",
    intro: "Your answers help us improve future events.",
    csatQuestion: "How satisfied are you with today's event?",
    csatLabels: ["Very unhappy", "Unhappy", "Okay", "Happy", "Very happy"],
    learnedQuestion: "Did you learn something new about scams today?",
    learnedOptions: [
      { code: "Y", label: "Yes" },
      { code: "S", label: "A little" },
      { code: "N", label: "No" }
    ]
  }
};
