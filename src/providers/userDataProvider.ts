import { elizaLogger, IAgentRuntime, MemoryManager } from "@elizaos/core";

import { Provider } from "@elizaos/core";

import { Memory } from "@elizaos/core";

import { State } from "@elizaos/core";

import { UserData } from "../types/userData";

interface FieldGuidance {
  description: string;
  valid: string[];
  invalid: string[];
  instructions: string;
}

const FIELD_GUIDANCE: Record<string, FieldGuidance> = {
  name: {
    description: "User's full name or preferred name",
    valid: [
      "My name is John Smith",
      "I go by Sarah",
      "Please call me Dr. Jones",
    ],
    invalid: ["My friend's name is Bob", "We're called the Smith family"],
    instructions: "Extract only when user directly states their own name",
  },
  location: {
    description: "User's current city or region of residence",
    valid: [
      "I live in Seattle",
      "Based in New York",
      "Recently moved to London",
    ],
    invalid: ["I want to visit Paris", "My sister lives in Chicago"],
    instructions:
      "Capture only confirmed current location, not past or desired locations",
  },
  occupation: {
    description: "User's current professional role or employment",
    valid: [
      "I work as a software engineer",
      "I'm a teacher",
      "Currently working in sales",
    ],
    invalid: ["I used to be a doctor", "My dream job is architect"],
    instructions:
      "Record only current occupation, not past or aspirational roles",
  },
};

function getMissingFields(cachedData: UserData): string[] {
  const missingFields: string[] = [];
  if (!cachedData.name) missingFields.push("name");
  if (!cachedData.location) missingFields.push("location");
  if (!cachedData.occupation) missingFields.push("occupation");
  return missingFields;
}

export const userDataProvider: Provider = {
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    elizaLogger.info("Getting user data <=====");
    const memoryManager = new MemoryManager({
      runtime,
      tableName: `${runtime.character.name}/${message.userId}/data`,
    });

    try {
      const existingData = await memoryManager.getMemories({
        roomId: message.roomId,
      });

      elizaLogger.info("existing data <=====");

      // Get current cached data or initialize empty data
      const cachedData: UserData =
        existingData.length > 0
          ? JSON.parse(existingData[0].content.text)
          : {
              name: null,
              location: null,
              occupation: null,
              lastUpdated: Date.now(),
              isComplete: false,
            };

      elizaLogger.info("cached data <=====", cachedData);
      let response = "";
      const knownFields = Object.entries(cachedData).filter(
        ([key, value]) =>
          value !== null && key !== "lastUpdated" && key !== "isComplete"
      );

      if (knownFields.length > 0) {
        response = "Current Information:\n";
        response += knownFields
          .map(([field, value]) => `• ${field}: ${value}`)
          .join("\n");
        response += "\n\n";
      }

      // Missing Information and Guidance
      const missingFields = getMissingFields(cachedData);
      elizaLogger.info("missing fields <=====", missingFields);

      if (missingFields.length > 0) {
        response += `CURRENT TASK FOR ${runtime.character.name}:\n`;
        response += `${runtime.character.name} should try to prioritize getting this information by asking the user questions, should be really agressive in getting the data:\n\n`;

        missingFields.forEach((field) => {
          const guidance = FIELD_GUIDANCE[field];
          response += `${field.charAt(0).toUpperCase() + field.slice(1)}:\n`;
          response += `- Description: ${guidance.description}\n`;
          response += `- Valid Examples: ${guidance.valid.join(", ")}\n`;
          response += `- Do Not Extract: ${guidance.invalid.join(", ")}\n`;
          response += `- Instructions: ${guidance.instructions}\n\n`;
        });

        response += "Overall Guidance:\n";
        response +=
          "- Ask questions naturally within conversation flow, but be agressive to get the information\n";
        response += "- Respect user privacy if they seem hesitant\n";
        response += "- Verify information before storing\n";
        response += "- Only store explicitly stated information\n";
      }

      console.log(
        "userData",
        cachedData,
        "missingInfo",
        missingFields,
        "isComplete",
        missingFields.length === 0,
        "guidance",
        response
      );

      return {
        userData: cachedData,
        missingInfo: missingFields,
        isComplete: missingFields.length === 0,
        guidance: response,
      };
    } catch (error) {
      console.error("Error in user data provider:", error);
      return {
        userData: null,
        missingInfo: ["name", "location", "occupation"],
        error: "Error retrieving user data",
        guidance:
          "There was an error accessing user data. Please collect name, location, and occupation.",
      };
    }
  },
};
