import {
  Evaluator,
  IAgentRuntime,
  Memory,
  State,
  elizaLogger,
  generateObject,
  composeContext,
  ModelClass,
} from "@elizaos/core";
import { UserData } from "../types/userData";

const extractionTemplate = `
TASK: Extract User Information
Analyze this message to extract user information if clearly stated.

MESSAGE:
{{message}}

RULES:
1. Only extract information that is explicitly stated
2. Only extract current information (not past or future)
3. Only extract information about the speaker (not others)
4. If information is unclear or not present, use null

Return a JSON object with:
{
  "name": string | null,     // The user's name if stated
  "location": string | null, // Current location if stated
  "occupation": string | null // Current job/profession if stated
}
`;

export const userDataEvaluator: Evaluator = {
  name: "GET_USER_DATA",
  similes: ["GET_INFORMATION", "EXTRACT_USER_INFORMATION"],
  description: "Get user data from the database",

  validate: async (
    runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> => {
    elizaLogger.info("Starting validation for user data extraction");
    try {
      const cacheKey = `${runtime.character.name}/${message.userId}/data`;
      elizaLogger.debug(`Checking cache with key: ${cacheKey}`);
      const userData = await runtime.cacheManager.get<UserData>(cacheKey);
      console.log("User data:", userData);
      // Skip if we already have complete data
      if (userData?.isComplete) {
        elizaLogger.info("User data is complete, skipping validation");
        return false;
      }

      elizaLogger.info("Validation passed - proceeding with data extraction");
      return true;
    } catch (error) {
      elizaLogger.error("Error in validation:", error);
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<boolean> => {
    elizaLogger.info("Starting user data extraction handler");
    try {
      const cacheKey = `${runtime.character.name}/${message.userId}/data`;
      elizaLogger.debug(`Fetching existing data from cache: ${cacheKey}`);
      const existingData = (await runtime.cacheManager.get<UserData>(
        cacheKey
      )) || {
        name: null,
        location: null,
        occupation: null,
        lastUpdated: Date.now(),
        isComplete: false,
      };

      elizaLogger.debug("Current existing data:", existingData);

      // Extract information using the template
      const context = composeContext({
        template: extractionTemplate.replace(
          "{{message}}",
          message.content.text
        ),
        state,
        templatingEngine: "handlebars",
      });

      const extractedInfo = await generateObject({
        runtime,
        context,
        modelClass: ModelClass.SMALL,
      });

      elizaLogger.debug("Extracted information:", extractedInfo);

      // Update data if we found anything new
      let wasUpdated = false;
      Object.entries(extractedInfo).forEach(([key, value]) => {
        if (value && !existingData[key]) {
          existingData[key] = value;
          wasUpdated = true;
        }
      });

      // Check if all required fields are filled
      existingData.isComplete = Boolean(
        existingData.name && existingData.location && existingData.occupation
      );
      existingData.lastUpdated = Date.now();

      // Save updated data
      if (wasUpdated) {
        await runtime.cacheManager.set(cacheKey, existingData);
        elizaLogger.info("Updated user data in cache");
      }

      return wasUpdated;
    } catch (error) {
      elizaLogger.error("Error in handler:", error);
      return false;
    }
  },

  examples: [
    {
      context: "Initial user interaction",
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "Hi, I'm John from Seattle. I work as a developer.",
          },
        },
      ],
      outcome: JSON.stringify({
        name: "John",
        location: "Seattle",
        occupation: "developer",
      }),
    },
  ],
};
