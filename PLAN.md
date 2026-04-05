# AI Document Analysis Tool #

## Overview ##
The AI Document Analysis Tool is a Retrieval Augmented Generation (RAG) system designed to analyze, summarize, and extract information from large documents. It utilizes a combination of the LangChain framework to manage the RAG pipeline, and the Google Natural Language API for natural language processing tasks such as Named Entity Recognition (NER) and sentiment analysis. The tool is built to handle various document formats, including PDFs and Word documents, and can be easily integrated into existing workflows for document management and analysis. Users can receive insights by interacting with a user-friendly chat interface.

## Architecture ##

- The frontend is implemented in React, REST APIs in Express.js, all using Typescript.
- The application supports a Redis Cache that stores AI context, uploaded documents, and session info. 
- A MongoDB should store all of the user uploaded documents and an instance of ChromaDB should store vector info
- The RAG pipeline should be implemented using Python.
- The user authentication should be implemented using Google OAuth as well as a manual email address and password checker through Firebase.
- Sessions




### Phase 1 Environment Setup (Python, Typescript) ###