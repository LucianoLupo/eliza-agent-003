import { State, Memory, Provider, IAgentRuntime } from "@elizaos/core";
import { UserData } from "../types/userData";

const getCacheKey = (runtime: IAgentRuntime, userId: string): string => {
  return `${runtime.character.name}/${userId}/data`;
};

const isDataComplete = (data: UserData): boolean => {
  return !!(data.name && data.location && data.occupation);
};

const getMissingFields = (data: UserData): string[] => {
  const missing: string[] = [];
  if (!data.name) missing.push("name");
  if (!data.location) missing.push("location");
  if (!data.occupation) missing.push("occupation");
  return missing;
};

const generateGuidance = (data: UserData, missingFields: string[]): string => {
  let guidance = "";

  // Add known information section
  const knownInfo = Object.entries(data)
    .filter(
      ([key, value]) => value && !["lastUpdated", "isComplete"].includes(key)
    )
    .map(([key, value]) => `${key}: ${value}`);

  if (knownInfo.length > 0) {
    guidance += "Known Information:\n" + knownInfo.join("\n");
  }

  // Add missing information section with specific prompts
  if (missingFields.length > 0) {
    guidance += "\n\nMissing Information:";
    const prompts = {
      name: "I don't know your name yet. Could you tell me what it is?",
      location: "Where are you currently located?",
      occupation: "What do you do for work?",
    };

    guidance += "\n" + missingFields.map((field) => prompts[field]).join("\n");
  }

  return guidance;
};

export const userDataProvider: Provider = {
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // 1. Check cache for existing information
      const cacheKey = getCacheKey(runtime, message.userId);
      const cachedData = await runtime.cacheManager.get<UserData>(cacheKey);

      const userData: UserData = cachedData || {
        name: null,
        location: null,
        occupation: null,
        lastUpdated: Date.now(),
        isComplete: false,
      };

      // 2. Identify missing information
      const missingFields = getMissingFields(userData);

      // 3. Generate specific guidance for collecting missing information
      const guidance = generateGuidance(userData, missingFields);

      return {
        userData,
        missingInfo: missingFields,
        isComplete: missingFields.length === 0,
        guidance,
        needsUpdate: missingFields.length > 0,
        lastUpdated: userData.lastUpdated,
      };
    } catch (error) {
      console.error("Error in userDataProvider:", error);
      throw new Error("Failed to process user data");
    }
  },
};
