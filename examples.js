export const exampleGroups = [
  {
    "label": "Prompt comparison",
    "note": "The conversational and brief prompts were written for the reference pose and checked against its measured geometry.",
    "examples": [
      {
        "id": "toothpaste",
        "name": "Toothpaste tube",
        "poster": "assets/prompt-toothpaste.png",
        "alt": "A rendered hand curves around a vertical toothpaste tube.",
        "azimuth": 60,
        "prompts": {
          "Detailed": "Aim for mostly straight ring and pinky fingers and a bent index finger; the middle finger and thumb MCP should be partly bent.",
          "Conversational": "On the tube, keep the thumb tip farther toward the nozzle than the ring fingertip. Leave the pinky tip some room.",
          "Brief": "Pinky tip clear of the tube."
        }
      },
      {
        "id": "mouse",
        "name": "Computer mouse",
        "poster": "assets/prompt-mouse.png",
        "alt": "A rendered hand curves over a computer mouse.",
        "azimuth": -180,
        "prompts": {
          "Detailed": "With the index and ring fingers bent and the pinky partly bent, keep the middle finger and thumb MCP mostly straight.",
          "Conversational": "For this grip, the ring finger should curl more than the index. Leave the pinky bent partway.",
          "Brief": "Middle finger nearly straight."
        }
      },
      {
        "id": "small-pyramid",
        "name": "Small pyramid",
        "poster": "assets/prompt-small-pyramid.png",
        "alt": "A rendered hand curls around a small pyramid.",
        "azimuth": -180,
        "prompts": {
          "Detailed": "Keep the index and ring mostly straight while the middle and pinky are bent. Leave the thumb MCP partly bent.",
          "Conversational": "Can you hold the pyramid with your middle finger and little finger curled? Leave your index fairly straight.",
          "Brief": "Curl a couple of fingers."
        }
      }
    ]
  }
];
