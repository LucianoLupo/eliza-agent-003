import {
  Evaluator,
  IAgentRuntime,
  Memory,
  ModelClass,
  ActionExample,
  MemoryManager,
  generateObject,
  UUID,
  elizaLogger,
} from "@elizaos/core";
import { z } from "zod";
import { UserData } from "../types/userData";

interface ExtractionResult extends UserData {
  confidence: number;
  source: string;
}

const UserDataSchema = z.object({
  name: z.union([z.string(), z.null()]),
  location: z.union([z.string(), z.null()]),
  occupation: z.union([z.string(), z.null()]),
  confidence: z.number(),
  source: z.string(),
});

const userDataTemplate = `TASK: Extract user information from the conversation.

# START OF EXAMPLES
These are examples of expected outputs:

## Positive Examples:
1. Input: "Hi, I'm Sarah from Seattle. I work as a software engineer."
Output: {
  "name": "Sarah",
  "location": "Seattle",
  "occupation": "software engineer",
  "confidence": 0.95,
  "source": "direct_mention"
}

2. Input: "I moved to Boston last year to start my job as a teacher"
Output: {
  "name": null,
  "location": "Boston",
  "occupation": "teacher",
  "confidence": 0.9,
  "source": "direct_mention"
}

## Negative Examples:
1. Input: "I might move to Chicago someday"
Output: {
  "name": null,
  "location": null,
  "occupation": null,
  "confidence": 0,
  "source": "hypothetical"
}

2. Input: "My friend Bob is a doctor in New York"
Output: {
  "name": null,
  "location": null,
  "occupation": null,
  "confidence": 0,
  "source": "not_user"
}

# CURRENT STATE
Current Known Information:
{{currentData}}

Recent Messages:
{{recentMessages}}

# INSTRUCTIONS
1. Extract name, location, or occupation if present in recent messages
2. Only extract information about the user, not other people mentioned
3. Only extract definitive information, not hypotheticals or wishes
4. Do not extract information that is already known
5. Set confidence score (0-1) based on how directly the information was stated
6. Indicate source as: direct_mention, indirect_mention, or inferred

Response Format:
\`\`\`json
{
  "name": string | null,
  "location": string | null,
  "occupation": string | null,
  "confidence": number,
  "source": string
}
\`\`\``;

const userDataEvaluator: Evaluator = {
  name: "GET_USER_DATA",
  description:
    "Extract essential user information: name, location, and occupation",
  similes: ["EXTRACT_USER_INFO", "GET_USER_INFO", "USER_DATA_COLLECTION"],

  examples: [
    {
      context: `Initial conversation with new user`,
      messages: [
        {
          user: "{{user1}}",
          content: { text: "Hi there! I'm Alex from Toronto." },
        },
        {
          user: "{{agent}}",
          content: { text: "Nice to meet you Alex! What do you do for work?" },
        },
        {
          user: "{{user1}}",
          content: { text: "I'm a data scientist at a research lab" },
        },
      ] as ActionExample[],
      outcome: `\`\`\`json
{
  "name": "Alex",
  "location": "Toronto",
  "occupation": "data scientist",
  "confidence": 0.95,
  "source": "direct_mention"
}
\`\`\``,
    },
    {
      context: `Conversation with partial information`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "Looking forward to starting my new job as an architect next month",
          },
        },
      ] as ActionExample[],
      outcome: `\`\`\`json
{
  "name": null,
  "location": null,
  "occupation": "architect",
  "confidence": 0.85,
  "source": "direct_mention"
}
\`\`\``,
    },
    {
      context: `Negative example - hypothetical information`,
      messages: [
        {
          user: "{{user1}}",
          content: { text: "I'm thinking about becoming a teacher someday" },
        },
      ] as ActionExample[],
      outcome: `\`\`\`json
{
  "name": null,
  "location": null,
  "occupation": null,
  "confidence": 0,
  "source": "hypothetical"
}
\`\`\``,
    },
  ],

  validate: async (
    runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> => {
    const memoryManager = new MemoryManager({
      runtime,
      tableName: `${runtime.character.name}/${message.userId}/data`,
    });

    const existingData = await memoryManager.getMemories({
      roomId: message.roomId,
    });
    elizaLogger.info("existing data from evaluator <=====", existingData);

    // If no data exists, we need to collect it
    if (existingData.length === 0) return true;

    try {
      const userData = JSON.parse(existingData[0].content.text) as UserData;

      // Validate data structure
      if (!userData || typeof userData !== "object") return true;

      // Check if we have all required fields with valid values
      const isComplete = Boolean(
        userData.name &&
          userData.location &&
          userData.occupation &&
          userData.isComplete
      );

      // Continue validating if we don't have complete data
      elizaLogger.info("isComplete evaluator <=====", isComplete);

      return !isComplete;
    } catch (error) {
      console.error("Error parsing user data:", error);
      return true; // Continue validating if we can't parse existing data
    }
  },

  handler: async (runtime: IAgentRuntime, message: Memory) => {
    elizaLogger.info("data evaluator <=====");

    const memoryManager = new MemoryManager({
      runtime,
      tableName: `${runtime.character.name}/${message.userId}/data`,
    });

    try {
      // Get existing data
      const existingData = await memoryManager.getMemories({
        roomId: message.roomId,
      });
      const currentData =
        existingData.length > 0
          ? JSON.parse(existingData[0].content.text)
          : {
              name: null,
              location: null,
              occupation: null,
              confidence: 0,
              extractionMethod: "ambiguous",
              lastUpdated: Date.now(),
              isComplete: false,
            };

      // Extract new information
      const result = (await generateObject({
        runtime,
        context: userDataTemplate.replace(
          "{{currentData}}",
          JSON.stringify(currentData, null, 2)
        ),
        modelClass: ModelClass.MEDIUM,
        schema: UserDataSchema,
      })) as unknown as { success: boolean; value: ExtractionResult };

      if (result.success) {
        const newData = result.value;

        // Only create new memory if we have better/new information
        if (newData.confidence > currentData.confidence) {
          // Merge with current data, keeping highest confidence information
          const updatedData = {
            name:
              newData.confidence > currentData.confidence
                ? newData.name
                : currentData.name,
            location:
              newData.confidence > currentData.confidence
                ? newData.location
                : currentData.location,
            occupation:
              newData.confidence > currentData.confidence
                ? newData.occupation
                : currentData.occupation,
            confidence: Math.max(newData.confidence, currentData.confidence),
            lastUpdated: Date.now(),
            isComplete: !!(
              newData.name &&
              newData.location &&
              newData.occupation
            ),
          };

          // Create new memory with updated data
          await memoryManager.createMemory(
            {
              userId: message.userId,
              agentId: runtime.character.name as UUID,
              roomId: message.roomId,
              content: { text: JSON.stringify(updatedData) },
              createdAt: Date.now(),
            },
            true
          ); // Set unique to true to avoid duplicates

          // Update runtime context if data is complete
          if (updatedData.isComplete && updatedData.confidence > 0.8) {
            const statusManager = new MemoryManager({
              runtime,
              tableName: `${runtime.character.name}/${message.userId}/status`,
            });

            await statusManager.createMemory(
              {
                userId: message.userId,
                agentId: runtime.character.name as UUID,
                roomId: message.roomId,
                content: {
                  text: JSON.stringify({
                    type: "USER_DATA_COMPLETE",
                    data: updatedData,
                  }),
                },
                createdAt: Date.now(),
              },
              true
            );
          }
        }
      }
      console.log("end of evaluator --- result <=====", result);

      return true;
    } catch (error) {
      console.error("Error in user data evaluator:", error);
      return false;
    }
  },
};

export { userDataEvaluator };
