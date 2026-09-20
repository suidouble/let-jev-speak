// VENDORED — do not edit. Generated from ../../vocabs.js by
// scripts/sync-lib.mjs. Run `npm run sync` after changing the root library.
/**
 * Vocabulary packs for the word-level decoder.
 *
 * The API caps a `choice` question at 255 options. Minus 7 punctuation marks
 * and "end", that leaves 247 word slots per request. CORE takes ~95 of them
 * (grammar depends on those words being present), so a domain gets ~150.
 *
 * Each pack is ordered most- to least-important: assembling a vocabulary
 * truncates from the tail, so the first words in a list are the ones that
 * survive blending.
 */

const words = (s) => s.trim().split(/\s+/).map((w) => w.replace(/_/g, ' '));

/**
 * A vocabulary word becomes part of an option description —
 * `The next word is "<word>"` — and of the rendered answer. Both places have
 * constraints that are easy to violate by accident:
 *
 *   - a double quote nests inside the description and makes it ambiguous
 *   - a control character (newline, tab) breaks the instructions' structure
 *   - a bare punctuation mark collides with the decoder's own punctuation
 *     options, so render() would treat the word as punctuation
 *   - an overlong string bloats every one of the ~10 decode calls
 *
 * @returns {string|null} a reason the word is unusable, or null if it is fine
 */
export const MAX_WORD_LENGTH = 40;

export function wordProblem(word, punctuation = []) {
  if (typeof word !== 'string') return `not a string (${typeof word})`;
  const w = word.trim();
  if (!w) return 'empty';
  if (w.length > MAX_WORD_LENGTH) return `longer than ${MAX_WORD_LENGTH} characters`;
  if (/["]/.test(w)) return 'contains a double quote, which nests inside the option description';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(w)) return 'contains a control character';
  if (punctuation.includes(w)) return 'is a bare punctuation mark, which the decoder handles separately';
  return null;
}

/** Function words. Shared by every pack — without these there is no grammar. */
export const CORE = words(`
a an and or but so because if when while although however therefore
the this that it its they them there what which who
is are was were be been being has have had do does did can could would
not no yes never always often sometimes usually maybe perhaps probably
very more most less only just also still even
I my me you your we of in on at to for from with without
by about into over between through before after since until as than like
such same different other each every both all some any one two many few
`);

export const DOMAINS = {
  general: {
    description: 'General everyday questions that do not fit a specialist field',
    words: words(`
      thing things way ways kind sort type part piece side place time
      people person someone everyone human life world day year
      reason reasons answer question point idea sense meaning definition
      depends argument case example fact truth
      good bad better best worse right wrong true false
      big small large long short high low new old
      know think mean say tell call called understand
      make makes made use used need want get give take come go
      work works happen happens seem look find
      real simple clear hard easy common usual normal strange
      often always never much many enough too
      start end begin finish keep stay change stop
      first second next last other another
      here there back down up out
`),
  },

  food: {
    description: 'Food, cooking, ingredients, meals, restaurants and what counts as what dish',
    words: words(`
      food sandwich sandwiches bread bun buns slice slices roll toast
      filling meat cheese salad sauce butter egg eggs
      hot dog dogs burger taco burrito wrap pizza soup cereal
      cook cooked cooking bake baked fry fried grill grilled boil
      eat eaten eating meal meals breakfast lunch dinner snack
      taste tastes flavour sweet salty sour spicy fresh
      recipe ingredient ingredients dish plate bowl
      restaurant kitchen chef menu order
      vegetable vegetables fruit meat chicken beef fish rice pasta
      milk water coffee tea drink
      served serve between two whole single split open closed hinged
      definition category counts count belongs technically arguably
      hungry full warm cold hot
`),
  },

  science: {
    description: 'Physics, chemistry, biology and how the natural world works',
    words: words(`
      science scientific research study experiment theory evidence
      light sun sky blue red colour colours wave waves wavelength
      scatter scattered reflect absorb atmosphere air gas molecules atoms
      energy heat temperature pressure force gravity mass weight speed
      water ice steam liquid solid boil freeze melt
      cell cells dna gene genes protein organism species evolution
      chemical reaction acid element compound
      earth planet space star stars moon universe
      electron atom nucleus charge magnetic field
      why because cause causes effect result happens process
      measure measured observe observed result data
      high low fast slow strong weak more less
      shorter longer smaller larger
      eye eyes see seen appear appears
`),
  },

  medicine: {
    description: 'Health, symptoms, diseases, treatment, drugs and medical care',
    words: words(`
      health medical doctor patient hospital nurse clinic
      symptom symptoms pain fever cough headache sick ill illness
      disease infection virus bacteria bacterial viral
      treat treatment treated cure heal recover
      drug drugs medicine dose antibiotic antibiotics
      blood heart lung lungs brain stomach skin bone
      chest arm leg head throat
      emergency urgent serious mild severe chronic acute
      risk risks dangerous safe
      diagnosis diagnose test tested result
      breathing breathe pressure rate
      injury broken cut wound
      rest sleep water food exercise
      should must need immediately soon wait
      cause causes caused common rare
`),
  },

  law: {
    description: 'Law, contracts, courts, rights, crime and legal obligations',
    words: words(`
      law legal lawyer court judge case trial
      contract contracts agreement clause terms party parties
      rights right duty obligation liable liability
      crime criminal guilty innocent evidence proof witness
      claim sue damages compensation penalty fine
      own owner property owned copyright licence
      employer employee work employment
      tenant landlord rent lease
      valid invalid enforceable binding void
      breach breached violate violated
      consent agree agreed signed written
      must may cannot allowed permitted required prohibited
      court rule ruling decision appeal
      jurisdiction state federal government
      protect protection responsible responsibility
      generally usually depends specific
`),
  },

  finance: {
    description: 'Money, business, markets, investing, accounting and company performance',
    words: words(`
      money financial finance bank account cash
      company business market markets stock stocks share shares
      price prices cost costs value worth
      revenue profit loss income expense expenses margin
      invest investment investor return returns risk
      debt loan interest rate rates bond bonds
      pay paid payment buy sell bought sold
      grow growth increase decrease rise fall rising falling
      asset assets liability liabilities equity balance
      tax taxes accounting report earnings quarter year
      customer customers sales sell
      high low strong weak healthy poor
      percent number amount total
      budget spend spending save saving
      economy economic inflation
`),
  },

  software: {
    description: 'Writing program code — languages, functions, variables, bugs, algorithms and debugging',
    words: words(`
      code software program programming developer engineer
      function functions variable variables value values type types
      bug bugs error errors crash fail fails broken fix fixed
      test tests testing run runs running build
      file files data database query server client
      api request response call calls return returns
      loop array list string number object class method
      memory thread threads lock race condition
      null undefined true false
      write written read reads input output
      language python javascript java
      version library framework package
      slow fast performance speed
      security secure vulnerability injection
      user users system application app
      line lines syntax logic
`),
  },

  support: {
    description: 'Customer support tickets, complaints, refunds, account and service issues',
    words: words(`
      customer support service help ticket issue problem
      account subscription plan billing invoice charge charged
      refund cancel cancelled payment card
      order delivery shipped arrived package
      email reply replied response contact agent team
      wait waiting delay delayed late
      broken working fails failed error
      sorry apologise thank thanks please
      request ask asked told said
      resolve resolved fix fixed solution
      angry upset frustrated happy satisfied unhappy
      urgent immediately soon today week
      again still never already
      login password access
      product item service
`),
  },

  emotion: {
    description: 'Feelings, mood, sentiment, tone and emotional reactions',
    words: words(`
      feel feels feeling felt emotion emotional
      happy sad angry upset calm excited afraid scared worried
      frustrated annoyed pleased satisfied disappointed
      love hate like dislike enjoy
      positive negative neutral mixed
      tone sound sounds seems appears
      sincere sarcastic joking serious honest
      strong mild slight deep
      mood state
      express expressed show shows hide
      react reaction respond
      person people someone
      because reason cause made makes
      very quite really extremely somewhat
      good bad better worse
      understand care caring kind cruel
`),
  },

  sports: {
    description: 'Sports, games, athletes, teams, matches and competition',
    words: words(`
      sport sports game games play player players team teams
      match win won lose lost draw score scored goal goals point points
      ball field court pitch track
      football soccer basketball tennis running swimming
      coach trainer training practice
      season league championship tournament cup final
      fast strong fit athlete athletes
      rule rules referee foul penalty
      race run runs runner jump throw kick hit
      time minute second record best
      compete competition against
      fan fans crowd support
      injury injured
      first second last place
`),
  },

  travel: {
    description: 'Travel, countries, cities, geography, transport and places',
    words: words(`
      travel trip journey visit tour holiday vacation
      country countries city cities town village place places
      map north south east west
      mountain river sea ocean lake island beach desert forest
      flight fly plane airport train bus car drive road
      hotel room stay booking
      ticket passport border
      distance far near close kilometre mile
      north south east west
      weather warm cold hot rain sun
      language local people culture
      europe asia africa america
      island capital population
      go going went arrive leave
      guide tourist
`),
  },

  education: {
    description: 'Schools, learning, teaching, students and academic study',
    words: words(`
      school student students teacher teach teaching learn learning
      class classroom lesson course subject study studied
      university college degree
      exam test grade grades mark result
      book books read reading write writing
      homework assignment project
      knowledge understand understanding explain explained
      question answer example
      child children young age year years
      skill skills practice
      difficult easy hard simple
      remember memorise
      curriculum education
      good better best improve
      know known taught
`),
  },

  history: {
    description: 'History, politics, government, war and past events',
    words: words(`
      history historical past ancient modern century year years
      war battle army soldier peace
      king queen empire nation country state
      government president leader power political politics
      vote election democracy law
      revolution independence freedom
      people society culture civilisation
      century period age era
      change changed became
      before after during since
      event events happened
      record records written
      old new first last
      important major
      cause caused result
`),
  },

  'art-music': {
    description: 'Art, music, film, literature and creative work',
    words: words(`
      art artist music musician song songs album band
      paint painting picture image colour colours
      film movie actor director scene story
      book books writer author novel poem poetry
      play theatre stage performance
      sound sounds note notes rhythm melody voice sing
      style beautiful creative design
      write wrote written create created made
      audience listener viewer reader
      classical modern popular
      instrument guitar piano
      culture famous known
      feel feeling express expression
      good great best
`),
  },

  nature: {
    description: 'Animals, plants, ecosystems and the living natural world',
    words: words(`
      animal animals plant plants tree trees flower grass
      cat cats dog dogs bird birds fish insect
      wild nature natural forest field river sea
      live lives living life
      eat eats food hunt
      sound sounds noise purr bark call
      body legs wings tail fur skin
      young baby born grow grows
      species kind kinds
      behaviour behave
      content happy calm comfort
      sleep rest
      water air earth
      warm cold
      why because reason
      common found
`),
  },

  weather: {
    description: 'Weather, climate, seasons and atmospheric conditions',
    words: words(`
      weather climate season seasons
      rain rains raining snow wind windy storm cloud clouds sunny
      temperature hot cold warm cool freezing
      summer winter spring autumn
      sky sun air atmosphere pressure humidity
      forecast predict expect
      degrees measure
      dry wet
      change changing warming global
      day night morning
      water ice
      high low
      north south
      today tomorrow
      cause causes because
`),
  },

  technology: {
    description: 'Consumer technology and gadgets — phones, laptops, batteries, screens and everyday device use',
    words: words(`
      technology computer device phone internet network online
      data digital electronic
      model ai artificial intelligence machine learning
      software hardware system
      screen keyboard camera
      user users account
      web website page site search
      connect connection wireless
      power battery speed fast slow
      store storage memory
      secure security privacy
      new modern old
      work works working
      information
      tool tools use used
`),
  },

  psychology: {
    description: 'Mind, behaviour, relationships, motivation and human psychology',
    words: words(`
      mind think thinking thought behaviour behave
      person people relationship friend family partner
      feel feeling emotion emotional
      motivation want need desire
      habit habits pattern patterns
      stress anxiety fear confidence
      memory remember forget
      learn learning change
      social group alone
      talk talking listen communication
      trust honest
      react reaction respond response
      cause because reason why
      child adult
      help support
      understand understanding
`),
  },

  'math-logic': {
    description: 'Mathematics, numbers, logic, proofs and reasoning about validity',
    words: words(`
      number numbers math count counts equal equals
      add subtract multiply divide sum total
      logic logical valid invalid argument premise conclusion
      true false statement statements
      prove proof follows therefore because
      if then all some none every any
      more less greater smaller than
      one two three ten hundred thousand million
      half double
      result answer correct wrong
      rule rules example
      set sets value
      probability chance likely
      means mean average
      show shows
`),
  },

  // ── IT specialisms ─────────────────────────────────────────────────────
  // `software` covers writing code; these cover the fields around it. The
  // descriptions are deliberately contrastive, because the router picks on
  // meaning and neighbouring IT domains are the easiest pairs to confuse.

  ai: {
    description: 'Machine learning and AI — models, neural networks, training, inference, LLMs and prompts',
    words: words(`
      model models ai artificial intelligence machine learning
      neural network networks layer layers weights parameters
      train trained training inference predict prediction
      data dataset datasets label labels labelled
      accuracy accurate error loss overfitting bias
      llm language prompt prompts token tokens context
      embedding embeddings vector vectors similarity
      classify classification cluster regression
      supervised unsupervised reinforcement
      transformer attention gpu compute
      generate generated output input
      benchmark evaluate evaluation test
      fine tuned base pretrained
      probability confidence score distribution
      hallucinate wrong correct
      algorithm algorithms learn learns
      billion million size large small
`),
  },

  database: {
    description: 'Databases — SQL, queries, tables, schemas, indexes, transactions and stored data',
    words: words(`
      database databases sql query queries table tables row rows column columns
      index indexes key keys primary foreign
      select insert update delete join
      schema design normalise
      transaction transactions commit rollback lock locking
      record records field fields value values
      store stored storage data
      slow fast performance optimise
      migration backup restore
      postgres mysql sqlite mongo redis
      relational document
      constraint unique null
      count sum group order
      cache caching replica
      size large million rows
      connection pool
`),
  },

  devops: {
    description: 'Deployment and infrastructure — servers, cloud, containers, CI/CD, monitoring and outages',
    words: words(`
      deploy deployment server servers cloud infrastructure
      container containers docker kubernetes image
      build pipeline ci cd release version
      environment production staging local
      monitor monitoring log logs alert alerts metric
      scale scaling load balance traffic
      restart crash down outage uptime downtime
      config configuration secret secrets
      run running process service
      memory cpu disk usage
      cost resource instance
      backup rollback failed failure
      automate automation script
      aws azure cloud region
      network port
`),
  },

  security: {
    description: 'Cybersecurity — vulnerabilities, attacks, encryption, passwords, authentication and breaches',
    words: words(`
      security secure vulnerability vulnerabilities attack attacker exploit
      password passwords authentication login credentials token
      encrypt encrypted encryption decrypt key keys
      breach leak stolen compromise compromised
      injection xss csrf phishing malware virus ransomware
      permission permissions access control admin
      firewall patch update vulnerable
      hash salt
      risk threat protect protection safe unsafe
      user users account accounts
      audit log logs detect detected
      private public sensitive data
      session cookie
      verify verified trust
      attack surface
`),
  },

  networking: {
    description: 'Networks and protocols — HTTP, DNS, TCP, latency, routing, firewalls and connectivity',
    words: words(`
      network networking protocol http https tcp udp ip dns
      request response header headers status code
      connection connect connected timeout latency
      packet packets route routing router gateway
      port firewall proxy
      client server host hostname domain
      bandwidth speed slow fast
      ssl tls certificate secure
      load balance balancer
      cache cdn
      local remote internet
      address lookup resolve
      fail failed error retry
      send receive data
      wifi wireless cable
`),
  },

  webdev: {
    description: 'Web front-end development — browsers, HTML, CSS, JavaScript interfaces, layout and rendering',
    words: words(`
      web browser page site website html css javascript
      element elements tag div class style styles
      layout responsive mobile desktop screen width height
      render rendering paint reload refresh
      button form input click event listener
      dom component components state props
      react framework library bundle
      api fetch request response json
      load loading slow fast performance
      colour font size margin padding
      user interface design
      mobile tablet
      script link
      display hidden visible
      error console
`),
  },

  'data-analytics': {
    description: 'Data analysis and statistics — metrics, dashboards, reports, averages, trends and pipelines',
    words: words(`
      data analysis analyse analytics metric metrics
      report reports dashboard chart graph table
      number numbers count total sum average mean median
      percent percentage rate ratio
      trend trends increase decrease growth
      sample size significant significance correlation
      distribution outlier outliers
      pipeline transform clean cleaning
      query filter group segment
      compare comparison change
      measure measured result results
      user users session sessions event events
      daily weekly monthly period
      high low
      insight insights
`),
  },

  twitter: {
    description: 'Twitter and X posts — tweets, replies, hashtags, followers, virality, trends and social media discourse',
    words: words(`
      tweet tweets tweeted post posts posted reply replies retweet
      thread threads quote mention mentions hashtag
      follower followers following follow unfollow
      viral trending trend timeline feed
      like likes share shares engagement reach views
      account profile bio handle verified
      block blocked mute report
      dm message
      user users audience people
      opinion take hot argument debate discussion
      angry outrage funny joke serious sarcastic
      news political drama
      short character characters limit
      algorithm feed shown
      screenshot link
      community online
`),
  },

  shopping: {
    description: 'Products, reviews, buying, prices and consumer goods',
    words: words(`
      product products item items buy bought purchase
      price cost cheap expensive value
      shop store online order delivery shipping
      review reviews rating star stars recommend
      quality good bad great poor
      brand model version
      work works working broken
      return refund exchange
      customer seller
      arrived package box
      size colour
      new used
      money worth
      week day
      happy disappointed satisfied
`),
  },
};

// Packs are written by hand, so a word can appear twice in one list or repeat
// something already in CORE. Both waste a slot out of 255, so drop them here
// rather than relying on every list being perfect. Order is preserved, which
// is what truncation depends on.
for (const pack of Object.values(DOMAINS)) {
  const seen = new Set(CORE);
  pack.words = pack.words.filter((w) => !seen.has(w) && seen.add(w));
}

/** Words available to a domain after CORE is accounted for. */
export const DOMAIN_BUDGET = 255 - 7 /* punctuation */ - 1 /* end */ - CORE.length;

export const DOMAIN_KEYS = Object.keys(DOMAINS);
