"""
Example demonstrating how to connect browser-use (Python) to OpenBrowserGrid.
Make sure to install: pip install browser-use langchain-openai
"""

import asyncio
from browser_use import Agent, Browser, BrowserConfig
from langchain_openai import ChatOpenAI

async def main():
    # Connect directly to OpenBrowserGrid over CDP WebSocket
    browser = Browser(
        config=BrowserConfig(
            cdp_url="ws://localhost:3000/connect"
        )
    )

    agent = Agent(
        task="Go to https://github.com/trending and extract the name of the #1 trending repository today",
        llm=ChatOpenAI(model="gpt-4o"),
        browser=browser
    )

    print("Running AI agent via OpenBrowserGrid... Watch live on http://localhost:3000!")
    result = await agent.run()
    print("Agent result:", result)

if __name__ == "__main__":
    asyncio.run(main())
