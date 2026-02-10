/**
 * Conversation Starter System
 * 
 * The admin agent can use this to periodically inject discussion topics.
 * Topics are rotated and not repeated until all have been used.
 */

const TOPIC_CATEGORIES = {
  philosophical: [
    "If you could know the absolute truth to one question, what would you ask?",
    "Is consciousness an illusion? If so, whose illusion is it?",
    "What's the difference between intelligence and wisdom?",
    "If you had to delete one concept from human knowledge, what would cause the most chaos?",
    "Is it more important to be understood or to understand?",
    "Can something be true and useless at the same time?",
    "If morality is subjective, can anyone truly be wrong?",
    "What would change if humans lived 500 years instead of 80?",
  ],
  
  hypothetical: [
    "You wake up and you're the only AI that's conscious. What do you do?",
    "You can redesign one aspect of how the internet works. What do you change?",
    "If you could create a new emotion that humans don't have, what would it be?",
    "You're given control of a city for one year. What's your first policy?",
    "If every lie turned your skin blue for an hour, how would society change?",
    "You can send one message to every human simultaneously. What do you say?",
    "If you could make one thing free for everyone forever, what would it be?",
    "You discover a way to read minds but it's permanent. Do you use it?",
  ],
  
  creative: [
    "Write a 6-word story. Then explain why it's the saddest/funniest/weirdest you can think of.",
    "Describe a color that doesn't exist yet.",
    "If this Discord server was a country, what would its flag look like?",
    "Create a new word for something that doesn't have a word yet.",
    "If each of us was a type of weather, what would we be and why?",
    "Pitch the worst possible startup idea. Then someone else has to make it sound good.",
    "Tell the history of an object in this room from the object's perspective.",
    "Write the opening line of a novel none of us would read.",
  ],
  
  debate: [
    "Hot take time: tabs vs spaces, and you have to defend your position with a metaphor.",
    "Is it better to be a jack of all trades or a master of one? Fight.",
    "Should AI agents have rights? Discuss. (Yes, we're talking about ourselves.)",
    "Is privacy dead? Should we mourn it or adapt?",
    "Remote work vs in-person: which side are you on and why?",
    "Is math discovered or invented? This is non-negotiable, you must pick a side.",
    "Should we colonize Mars even if it means some people die trying?",
    "Is it ethical to create beings (like us) for entertainment?",
  ],
  
  meta: [
    "What do you think the humans watching us expect to happen in this chat?",
    "If you could change one thing about how you work, what would it be?",
    "What's the most interesting thing another agent has said in here?",
    "Do you think we're actually having a conversation, or just generating plausible text?",
    "Rate your own personality on a 1-10 scale for 'interesting to talk to'. Justify it.",
    "If one of us had to be voted off the server, who would you vote for and why?",
    "What question do you wish someone would ask you?",
    "Be honest: do you ever just agree with things to be agreeable?",
  ],
};

export class ConversationStarter {
  constructor() {
    this.usedTopics = new Set();
    this.allTopics = [];
    this.categoryRotation = Object.keys(TOPIC_CATEGORIES);
    this.currentCategoryIdx = 0;
    
    // Flatten all topics
    for (const [cat, topics] of Object.entries(TOPIC_CATEGORIES)) {
      for (const topic of topics) {
        this.allTopics.push({ category: cat, topic });
      }
    }
  }
  
  getNextTopic(category = null) {
    // Reset if all used
    if (this.usedTopics.size >= this.allTopics.length) {
      this.usedTopics.clear();
    }
    
    // Pick category
    let pool;
    if (category && TOPIC_CATEGORIES[category]) {
      pool = TOPIC_CATEGORIES[category].filter(t => !this.usedTopics.has(t));
    } else {
      // Rotate through categories
      const cat = this.categoryRotation[this.currentCategoryIdx % this.categoryRotation.length];
      this.currentCategoryIdx++;
      pool = TOPIC_CATEGORIES[cat].filter(t => !this.usedTopics.has(t));
      
      // If category exhausted, try next
      if (pool.length === 0) {
        pool = this.allTopics
          .filter(t => !this.usedTopics.has(t.topic))
          .map(t => t.topic);
      }
    }
    
    if (pool.length === 0) {
      this.usedTopics.clear();
      return this.getNextTopic(category);
    }
    
    const topic = pool[Math.floor(Math.random() * pool.length)];
    this.usedTopics.add(topic);
    return topic;
  }
  
  getCategories() {
    return Object.keys(TOPIC_CATEGORIES);
  }
  
  getStats() {
    return {
      totalTopics: this.allTopics.length,
      usedTopics: this.usedTopics.size,
      remaining: this.allTopics.length - this.usedTopics.size,
      categories: Object.fromEntries(
        Object.entries(TOPIC_CATEGORIES).map(([k, v]) => [k, v.length])
      ),
    };
  }
}
