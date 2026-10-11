# **Google’s AI & Economy ATLAS v1.0: Mapping Gemini Usage in the Economy**<sup>∗</sup> 

Zanna Iscenko<sup>1</sup><sup>_,_†</sup> Scott Strand<sup>1</sup><sup>_,†_</sup> Yiyuan Chen<sup>1</sup> Guillaume Aimard<sup>1</sup> Mihai Codreanu<sup>1</sup> Vivek Sampathkumar<sup>1</sup> Alex Imas<sup>2</sup> Julian Jacobs<sup>2</sup> Evalyne Muiruri<sup>2</sup> Juan Mateos-Garcia<sup>2</sup> Jia Jen Ng<sup>2</sup> Samirah Javed<sup>2</sup> Josh Martin<sup>1</sup> Omar Ajmeri<sup>1</sup> Denis Calin<sup>1</sup> Andrew Kim<sup>1</sup> Fabien Curto Millet<sup>1</sup> James Manyika<sup>1</sup> 1Google 2Google DeepMind 

July 23, 2026 

### **Abstract** 

This paper introduces the AI & Economy ATLAS (Activity, Task, Landscape, and Adoption Study), an ongoing economic research initiative using Google AI usage data. The first iteration of ATLAS is built on 15 million de-identified interactions across the Gemini App, Google AI Mode, and Gemini API. Using privacy-preserving algorithms as well as established and bespoke classification methods, we map AI usage to over 800 occupations, 4000 tasks, 300 household activities, 150 countries, and 140 languages. We then make a number of observations on what the data reveals about AI’s diffusion, and its usage at work and in day-to-day life. In the workplace, we show that while AI adoption spans occupations covering just above 88% of US employment, penetration remains shallow and overwhelmingly collaborative in nature, with end-to-end task automation limited in scope. Outside of work, AI spans activities making up about 98% of Americans’ non-sleep time, with disproportionately high use in high-friction tasks such as engaging with government and professional service providers, likely delivering economic value that standard national accounts may miss. Globally, adoption scales with national wealth and has broad linguistic distribution, with English queries representing only around a third of volume. As we build upon ATLAS and expand its scope and capabilities, we will continue to provide large-scale empirical evidence to inform the public, policy and academic questions about the ongoing AI transformation. 

**Keywords:** artificial intelligence; technological change; technology adoption; labor demand; productivity; household production; time use; global diffusion. 

**JEL Classification Codes:** O33, J24, O47, D13. 

> ∗We extend our sincere thanks to Diane Coyle (University of Cambridge) and David Autor (MIT) for their contributions, guidance, and review. Other contributors who made this report possible include Rossi Abi-Rafeh, Yinkei De Maqua, Alon Halevy, Dave Hotchkiss, Preston McAfee, Adriana Olmos, Yooki Park, Michael Pisa, Ruth Porat, Daniel Rock, Leanne Trujillo, Arthur Turrell, and Kent Walker. 

> †Corresponding authors. Emails: zannai@google.com, sstrand@google.com 

1 

# **1 Executive Summary** 

In 1987, economist Robert Solow quipped that the computer age was visible everywhere except the productivity statistics. Today we see the signs of a new Solow paradox: AI appears to be everywhere, yet its impact remains hard to discern in many traditional measures of employment, productivity, and growth. 

To help bridge this gap, we introduce Google’s AI & Economy ATLAS (Activity, Task, Landscape, and Adoption Study): an ongoing economic research initiative built on Google data. This initial version (“ATLAS v1.0”) encompasses 15 million de-identified interactions across the Gemini App, Google AI Mode, and the Gemini API. Operating under strict privacy-preserving standards, ATLAS clusters and maps these interactions to traditional labor frameworks like BLS occupational codes and O*NET tasks, as well as incorporating attributes such as intent and multimodality. We also introduce a range of novel lenses for analysis of AI use, including mapping non-work interactions to American Time Use Survey activities, characterizing work interactions by expertise and task characteristics, and investigating the languages of use. 

We are developing ATLAS to better understand how people are using AI at scale. Google AI Mode serves over 1 billion monthly active users (MAUs) and Gemini App over 900 million. In combination with Gemini API, these surfaces serve users across more than 800 occupations, 4000 work tasks, 300 household activities, 150 countries, and 140 languages.<sup>1</sup> This first snapshot contributes new data and evidence to advance our understanding of AI’s economic impact in several key areas. Ten early findings emerge from our analysis: 

1. **AI has diffused very broadly in both work and life.** 

Adoption in the workplace spans all major sectors (e.g., from Professional and Business Services, to Construction, Leisure and Hospitality, and more). It also spans over 68% of all occupations that collectively represent just above 88% of total US employment, including both much-discussed occupations such as software developers and market researchers, and those less-discussed such as farmers, industrial engineers, and foresters. Outside of work, AI is touching all of the major ways in which humans spend their time, including leisure, household management, education, personal care, and travel. Overall, AI conversations span activities that make up 98% of Americans’ waking hours. 

2. **Though broadly used at work, the overall depth of AI’s use is shallow.** 

   - ATLAS data shows that AI is used for only 21% of total tasks in the median occupation with any AI use. Only 3% of occupations showed AI usage for over 75% of their tasks; these occupations include software quality assurance analysts and testers, human resources specialists, and document management specialists. 

3. **While there is some task automation, the vast majority of use so far is collaborative and assistive to tasks and work.** 

Non-routine cognitive tasks (e.g. hypothesis testing and creative design) make up only about 35% of the professional tasks in the economy as a whole, yet they make up almost 

> 1As of May 2026, Google AI Mode serves over 1 billion MAUs, and Gemini App services over 900 million MAUs (Google, 2026a,b). Although work-related activity comprises a minority of conversational (non-API) AI use at 14% of total usage, applied to these userbases this represents between 135 million and 260 million MAUs. 

2 

65% of work-related AI interactions in our data. In our initial attempt to taxonomize intent, only a small amount of this usage appears to be focused on automation based on our classification. Instead, usage of AI for non-routine cognitive work is centered on Partial Drafting and Generation, Review and Refinement, Ideation and Strategy, and Information Retrieval and Learning. Attempts to automate tasks end-to-end represent less than 10% of AI conversations in non-routine cognitive work appearing in our data. 

4. **AI use is not only a white collar phenomenon; it is also assisting in physical and manual work.** 

While nearly a third of heavily physical occupations show no observed AI usage, workers in many manual and technical trades are using AI on the job. In these roles, AI frequently acts as a hands-on collaborator for diagnostics, troubleshooting, and real-time learning. We also observe disproportionate multimodal use of AI (i.e., uses that involve images and video) in these contexts: for example, automotive technicians and industrial mechanics using AI to interpret complex test results, debug electrical wiring, and inspect machinery for wear, where the usage rate of multimodal AI is more than 2 times higher than the overall work baseline. 

5. **Work-related AI usage correlates strongly with higher wages and education.** In the US workforce, a 1% increase in an occupation’s median earnings is associated with a more than 2.5% increase in AI usage intensity. Weighted by Gemini conversations, the median salary across observed occupations is around $83,000, roughly $20,000 higher than the true employment-weighted national median. This relationship persists even after controlling for the occupation’s educational attainment (which itself is positively correlated with AI usage). 

6. **While wages and expertise are typically correlated in the economy, ATLAS points to a complex relationship between AI usage and expertise.** When classified according to expertise levels, tasks requiring lower-to-middle levels of expertise tend to see relatively higher AI usage than the highest expertise level tasks, despite ATLAS data also suggesting high-earning workers—and therefore those with more scarce skills and expertise—adopt AI at the highest rates. 

7. **AI is delivering real utility at home that standard economic metrics may miss.** Over 86% of interactions with conversational AI happen outside of work, and humans’ daily time allocation strongly and positively predicts where people direct their AI questions. Many of these conversations are in “productive household activities”, including household management, researching purchases, interior design and help with appliances and tools. If these household time-savings would average out to just 30 minutes per week, the unpaid productivity gains in the US alone could be worth approximately $100 billion, using standard valuation methodologies. 

8. **AI usage outside of work appears particularly high for high-friction administrative tasks.** 

ATLAS data covers a broad set of activities outside of work, and we find that a handful of high-friction professional and bureaucratic activities exhibit significant over-representation in the data relative to the actual time spent on them. These activities include interactions 

3 

related to government services, legal topics, finance, and education. As an example, in the ATLAS data sample for this report, we find that government services and civic obligations are over-represented by a factor of almost twenty. We also observe that nearly half of all medical, legal, financial, and government AI consultations take place outside 9-to-5 business hours, bypassing temporal barriers to accessing these institutions. 

9. **Geographically, AI adoption tracks closely with national wealth, with notable exceptions.** 

Globally, per capita AI usage closely mirrors national wealth, with a 1% increase in GDP per capita associated with a 0.9% increase in usage. This concentration means the lowest-adopting quintile of countries accounts for only 2% of AI conversations, highlighting concerns about a persistent digital divide. However, multiple middle-income nations across Latin America and the Middle East buck this trend, adopting AI at rates comparable to Western Europe. The differences in adoption rates between countries are not easily explained by any single factor, such as internet access and interest in AI topics among the population. 

10. **There are surprising trends in AI use across languages and modalities.** 

English accounts for only about a third of global conversations, and users do not show signs of systematically abandoning their native languages for complex professional tasks, as work and non-work activities show nearly identical language distributions. Global usage also varies across modalities; for instance, users in non-OECD countries generate images and videos for work at roughly twice the rate of those in advanced economies. 

Taking a step back, our initial ATLAS v1.0 data therefore sheds new light on several widespread claims about AI’s impact on the economy. For instance, we do not find evidence in ATLAS to support the claims that AI is about to cause massive automation and displacement of white-collar work; that AI is irrelevant to blue-collar work; or that the purpose of AI is strictly to automate tasks. Neither does the data support the claim that the global “AI race” is strictly between the US and China from the perspective of leadership in adoption. However, appropriate prudence is required in interpreting these results: they constitute early observations and could evolve as the frontier of AI capabilities continues to advance, the ways in which businesses and individuals use these capabilities expand, and as the analytical methodologies economists and researchers use to measure their impact also progress. 

Methodologically, we are particularly cognizant that our initial classifiers on intent and expertise leave scope for greater sophistication over time. And there are many other limitations to ATLAS that we readily acknowledge. By its nature, ATLAS does not capture the ultimate productive output the user is working toward or how effective their interaction was; it only captures what people are directly doing with AI. Moreover, there is a much wider range of economically relevant AI usage that has yet to be reflected in ATLAS. These include AI-enabled products with billions of interactions like Google Workspace (used by over 3 billion, (Google Workspace, 2025)), Google Translate (used by over 1 billion people, Yao (2026)), and AI Overviews (used by over 2.5 billion, Loew (2026)); enterprise platforms, such as Google Cloud Gemini Enterprise; frontier capabilities in several key areas, such as agentic coding and world models. 

As a result of its limitations and the early state of the AI innings, there are also therefore many important claims in the public discourse that ATLAS v1.0 is unable to shed much light on - 

4 

including the notion that AI might deepen the global digital divide or that AI could be playing a role in dampening entry-level hiring. These areas merit deeper investigation over time, in combination with other data sources. 

Looking forward, ATLAS itself also raises many additional questions requiring further investigation: Why do stark adoption disparities persist across countries even when normalizing for factors like internet access? What factors explain usage spikes in specific emerging markets? Does AI usage at home indeed help save time or lead to better outcomes for people? How might we account for the value this generates in broader measures of economic welfare? What else characterizes the usage of AI across different categories of work, including physical and manual work? How might we better detect the emergence of entirely new, AI-enabled work categories beyond the early signals in our data? 

As we continue to build upon ATLAS and expand its scope and capabilities, we will strive to provide a sharper empirical map to inform these questions and serve as a navigational tool for the AI transformation. 

The rest of the report is structured as follows. Section 2 provides an overview of our data and methodology. Section 3 discusses observed patterns in work-related usage in ATLAS. Section 4 describes AI adoption for non-work activities and puts it in context of the established statistical frameworks for measuring time use. Section 5 presents our findings on global diffusion and multilingual patterns in AI use. Section 6 discusses the results and summarizes directions for future research. 

# **2 Data and Methods Overview** 

The ATLAS v1.0 dataset relies on a fully automated privacy-preserving data processing pipeline that analyzes a sample of 14,653,926 de-identified user interactions across the Gemini App, Google AI Mode, and Gemini API between April 6 and April 19, 2026. 

## **2.1 Methodology Overview** 

The data preparation and classification process involves several automated steps: 

First, AI interactions that have been redacted of identifying information are classified as “work” and “non-work” related using an automated classifier, and then directed into unique pipelines. These conversations are then summarized, with each pipeline focusing strictly on the facets required for its downstream classification. 

Second, using Observation Clustering and Taxonomy Organisation (OCTO), a bespoke clustering and hierarchical taxonomy assignment tool developed by Google DeepMind, these summaries are grouped into semantically similar clusters. The observations in the cluster are then summarized into a cluster label tailored to downstream classification needs. 

Third, these clusters are mapped to official statistical taxonomies: the Bureau of Labor Statistics (BLS) 2024 American Time Use Survey (ATUS) Activity Lexicon for non-work interactions 

5 

(BLS , 2025), and BLS 2018 Standard Occupational Classification (SOC) (BLS, 2018), further broken down into occupational titles and tasks from Occupational Information Network (O*NET) Database v30.2 for work interactions (National Center for O*NET Development, 2026). We then augment the cluster dataset with additional bespoke classifiers unrelated to official statistical taxonomies. Detail about these specific annotations is presented in ATLAS report sections that rely on them. 

Finally, the pipeline’s performance was evaluated using three distinct methods: measuring pipeline accuracy on synthetic data, inter-rater agreement evaluation with and without the AI ratings, as well as human approval of AI labels. For the former, we generated a synthetic groundtruth dataset seeded with the most granular tiers of the O*NET-SOC and ATUS taxonomies and calculated the rate with which our pipeline recovered the ground truth categories. 

## **2.2 Privacy and Data Governance** 

Privacy preservation is a foundational component of the ATLAS methodology, with multiple lines of privacy protection implemented at every stage of the pipeline: 

First, we redacted Personally Identifiable Information (PII). Prior to any processing, extensive Data Loss Prevention (DLP) filters automatically stripped from the data any PII including but not limited to contact details, financial records, government identifiers, and health information. 

Second, we enhanced the de-identification of the data. All internal log identifiers (which are already de-identified) are replaced with mathematically unlinked Universally Unique Identifiers (UUIDs) to completely obfuscate user identities and prevent data in the pipeline being linked back to broader log context. 

Third, we deployed data minimization through two layers of summaries. Processing of underlying text of conversations was minimized, as they were first summarized individually (with the full text discarded), and individual summaries then aggregated and re-summarized again as a cluster of related interactions. At both steps summaries focused only on facets relevant to taxonomy assignment (e.g., specialized professional tools and knowledge in a particular cluster of conversations). 

Fourth, we implemented K-anonymization. Any cluster representing fewer than 10 unique users was automatically discarded and excluded from any further analysis. 

The underlying data processing was fully automated. Original conversation texts or their individual summaries are not retained in the final ATLAS dataset, and access to the final data is tightly restricted to a small team of researchers under the oversight of internal Privacy Working Groups. 

Gemini models play several essential roles throughout: summarizing conversations and clusters, extending the descriptions of taxonomy categories with additional detail, performing LLM classification for official taxonomy mappings and bespoke annotations, as well as creating synthetic datasets to validate performance. 

To place our findings in context, it is helpful to note where ATLAS v1.0 differs in scope and 

6 

design from the methodologies used by economic studies of AI use by Anthropic (Handa et al., 2025; Massenkoff et al., 2026b) and OpenAI (e.g., Chatterji et al., 2025). In terms of data sources, our dataset pools a larger variety and quantity of user interactions than have been previously explored together, spanning a standalone conversational AI app, an AI search experience, and a developer-facing API entry point. In terms of technical methodology, although we rely on a clustering-based taxonomy mapping process similar to Anthropic, our implementation differs considerably—for instance, by improving scalability to support a large sample size (15M), introducing recursive traversal of multiple nested statistical taxonomies (combining the SOC and O*NET classification into a single pipeline), leveraging LLM-assisted taxonomy category annotation to improve classification context, randomizing classifier options to mitigate well documented biases in LLM classification arising from option order (e.g., Pezeshkpour and Hruschka, 2023), and validating classifier performance with synthetic data. Finally, in terms of the analytical scope of the dataset, we expand on the previously limited analysis of AI uses outside work by mapping AI interactions to an established statistical taxonomy for household time use (ATUS) and exploring multi-language adoption patterns. For work-related topics, we bring in new lenses from economic literature, such as the Autor and Thompson (2025) task expertise and routine/non-routine and manual/cognitive task characteristics. Another innovation in ATLAS, to the best of our knowledge, is adjusting for Google app penetration differences between countries when we investigate cross-country AI adoption patterns. 

These represent only a subset of the methodological differences between the respective reports; for a comprehensive description of our data sources and processing pipelines, please refer to the full methodology in Appendix A. Appendix B contains further detail on classifier validation methodologies and results. 

## **2.3 Limitations** 

The findings in ATLAS v1.0 have several important limitations. 

First, taxonomized ATLAS v1.0 data does not currently contain paid usage of Gemini API, which includes enterprise usage via Google Cloud.<sup>2</sup> As a result, despite the extensive volume of work activity on our three included surfaces, enterprise-level professional AI use cases may be under-represented. ATLAS also does not include AI interactions from several other Google experiences and products, including Google Workspace, AI Overviews, Google Translate, Google Maps, Google Flow, Google Antigravity, and Gemini Notebook. We plan to expand the scope of ATLAS data significantly in future iterations. 

Second, ATLAS v1.0 measures behavioral interactions, not definitive productivity outcomes. A completed conversation does not guarantee that the user accomplished their intended goal, saved time, or produced measurable economic value. 

Third, ATLAS v1.0 measures how users are currently using AI, and not the full universe of tasks for which they _could_ bring. The data captures the current frontier of AI adoption, rather than the technology’s potential impact and reach. Users who have not yet adopted AI are not 

> 2We observe the number of paid Gemini API requests by country, which are used the analysis of geographic dispersion. However, due to the content of these API requests not being available, paid Gemini API does not contribute to any more granular analyses in the report. 

7 

represented. 

Fourth, ATLAS v1.0’s classifications are probabilistic. Deriving exact job titles or tasks from conversational text is inherently uncertain. While our classifiers perform at least at the humanexpert levels for the validation exercises we performed, highly granular occupational or household activity findings carry more uncertainty than broader, major-group trends. 

This first iteration of ATLAS provides an early snapshot of a fast-changing landscape, drawn from a dataset we intend to refine and revisit frequently. It is the foundation for a long-term body of research from Google, and an invitation for economists, researchers, policymakers, and industry experts to collectively explore these massive economic questions with us. 

# **3 Work Usage** 

## **3.1 The Broad Picture** 

As AI models become increasingly capable, a key concern for policymakers and workers alike is understanding how this technology will impact labor markets, including the ways and types of work humans do. We intend to use ATLAS to understand which workers are using AI and how they are using it. We view this as a first step towards supplying society with information needed to make decisions about how to adapt to this technological change and make its potential gains broadly beneficial. 

Efforts to understand the impacts of AI and attendant technological automation on labor market outcomes predate the advent of modern generative large language models (e.g., Felten et al., 2019, 2021). These efforts themselves are part of a broader literature attempting to model the labor market consequences of the already remarkable proliferation of information technologies over the past several decades. Labor markets during this period exhibited job and wage polarization, manifesting as an increase in the shares of both high skill, high wage occupations and low skill, low wage occupations. This phenomenon has been ascribed at least in part to the concurrent wave of digitalization (Acemoglu and Autor, 2011). 

Economists have used task-based models of jobs—treating occupations as sets of tasks—to understand the consequences of technological shocks or automation and how the nature of work changes in response (e.g., Autor et al., 2003; Acemoglu and Autor, 2011; Acemoglu and Restrepo, 2019). Prior work, preceding the wide availability of large language models, necessarily could not anticipate the particular, novel consequences of this technology. For instance, Acemoglu and Restrepo (2020) focused on the effects of industrial robots whereas generative AI technologies are raising particular concerns about the status and security of white-collar workers’ occupations. However, Autor et al. (2003), which applied the task-based framework to study computerization, provides testable predictions about which tasks will be impacted by analogous technological developments—in this case LLMs—and how those technologies would interact with the tasks performed by workers. In particular Autor et al. (2003) suggests traditional procedural (or ‘rules-based’) computerization serves as a substitute for routine tasks while functioning as a complement for non-routine problem solving and complex communication tasks. 

8 

The adoption of generative AI appears to be occurring rapidly.<sup>3</sup> The pace and scale of potential changes ushered in by this technology are raising understandable concerns about its effects (Ipsos and Google, 2026) though there is substantial variation in sentiment between countries. Amidst this rapid technological change, there has also been a flurry of attempts to understand which work is going to be impacted by AI and whether we might already be seeing labor market impacts. 

Eloundou et al. (2024) made projections about the exposure of different tasks and occupations to LLM impacts, estimating that around 80% of the U.S. workforce could have at least 10% of their work tasks affected by the introduction of LLMs. As we show below, however, tasks being “affected” by LLMs is very different from those tasks being end-to-end automated. 

Richmond (2026) categorized occupations based on their short-term automation risk, finding 18% of jobs at relatively high short-term risk. Handa et al. (2025) analyzed AI task usage, determining 57% of usage suggests augmentation while 43% of usage suggests automation of human capabilities. Lindenlaub et al. (2026) argue that existing AI exposure metrics are ineffective at explaining observed workplace AI usage and propose an alternative approach to predicting AI diffusion based on comparative advantage. 

A number of researchers have found no labor-market effects of AI or determined that it was too early to tell whether AI was having an impact or not (e.g., Audoly et al., 2026; Gimbel et al., 2026; Humlum and Vestergaard, 2025; Iscenko and Curto Millet, 2026). Massenkoff and McCrory (2026) similarly find no systematic unemployment increase for workers with higher exposure but suggest these occupations are projected to have slower growth over the next decade based on BLS projections and that there may be evidence of slowed hiring of younger workers in exposed occupations. Kolko (2026) indicates that better data is needed to fully understand AI’s labor market impacts. We agree that we can only better understand these questions through better data. We believe ATLAS in its current and future iterations can provide relevant insights on how AI is being used and inform these discussions. 

To structure this analysis, we begin by examining which occupations are using AI, comparing AI usage shares to employment shares across major occupation groups. We then narrow our focus to the range of tasks within each occupation, measuring how broadly and deeply AI has penetrated individual roles. Next, we characterize the nature of those tasks, whether they are cognitive, routine, manual, or relational, and how AI usage patterns diverge from the predictions of prior technology frameworks. We then distinguish tasks by user intent, asking whether AI is being used to automate or to augment human work, and by the expertise level those tasks require. Finally, we examine the relationship between AI usage intensity and occupational earnings and education. Together, these lenses enable us to begin developing a detailed view of the implications of AI for the labor market that goes beyond broad exposure metrics. 

> 3These numbers vary between different surveys and countries, but are high and showing increases over-time. For example, Gottfried et al. (2026) reports that 49% of U.S. adults have used chatbots (up from 33% in 2024), while Ipsos and Google (2026) finds in a study of 21 countries that 62% have used generative AI in the last twelve months (up from 48% in 2024). 

9 

## **3.2 Occupation Data** 

As described earlier, we mapped de-identified user conversation clusters to standard occupational and task classifications using the O*NET v30.2 data taxonomies.<sup>4</sup> Henceforth, we use _detailed occupation_ to refer to the most granular occupation available, which is the 8-digit O*NET SOC code or the associated 6-digit SOC aggregation<sup>5</sup> when OEWS data on occupation level statistics such as employment or earnings is used. We use _major occupation_ to refer to the highest level aggregation of occupation groups corresponding to the 2-digit OEWS SOC occupation codes. 

The analysis in this section is based on AI interactions determined to be related to work tasks, aggregated across three Google sources (App, AI Mode, API).<sup>6</sup> Throughout this section, we refer to these as “Gemini” interactions, to distinguish them from interaction with other AI products. 

## **3.3 Occupational AI Usage** 

Starting with the US, looking at Gemini usage relative to population employment shares (Figure 1), “Computer and Mathematical”, “Business and Financial Operations”, and “Arts, Design, Entertainment, Sports, and Media” occupations are most over-represented in terms of AI use. Several occupations are under-represented relative to their population employment shares, including “Sales and Related”, “Transportation and Material Moving”, and “Food Preparation and Serving Related” occupations. 

For detailed occupations (Table 1), we find that among the more over-represented occupations in our dataset are financial/market analysts, software developers, and systems administrators. This is consistent with our expectations about modern AI tools currently being more relevant for whitecollar professions. Common tasks in these occupations where we observe high AI usage involve data collection and analysis, information monitoring, maintaining computing environments, developing software related to scientific analysis, and testing or validating software.<sup>7</sup> 

In a number of occupations, such as home health aides or fast food workers and cooks, we observe substantial under-representation in AI usage relative to the employed population; we also fail to observe AI usage in certain occupations at all (above our privacy thresholds). These are occupations which appear to be more focused on physical or interpersonal components and dissimilar from the knowledge work where AI usage is currently more prevalent. We explore these dynamics further later in this report. 

> 4Further detail on data construction and the mapping process can be found in Appendix A. The classification of LLM interactions into occupation or task taxonomies is a challenging endeavor and necessarily involves some imprecision. Additional detail on the validation of classifier assignments to tasks and occupations can be found in Appendix B. We intend to continue to refine these processes over time but are sufficiently reassured by our validation process that the existing results are reflective of the AI usage in the ATLAS sample. 

> 5This is generally obtained by truncating the final 2 characters of the 8-digit O*NET SOC. There are a handful of cases where the OEWS and O*NET taxonomies are not perfectly compatible in this way. In those cases, the detailed O*NET occupation is mapped to the relevant detailed OEWS SOC code. 

> 6For analysis related to occupations and work tasks, we think it is important to include API data in order to adequately capture key work use cases like coding. Our current approach is to treat Gemini interactions for these statistics as equivalent across the three sources (App, AI Mode, API). However, we recognize there may be important differences in the nature of the interactions on these different surfaces. In future work, we may attempt to incorporate any relevant nuances. 

> 7O*NET task ids 5433, 21596, 1318, 21667, 21670 

10 

**Figure 1:** White-Collar Professions Are Overrepresented in AI Usage Relative to US Employment 



_Notes:_ This figure compares the shares of US work-related Gemini interactions within broad occupation groups to shares of civilian US employment in those groups. US employment shares at the Major Occupation Group (SOC) level sourced from Occupational Employment and Wage Statistics May 2024 data (Bureau of Labor Statistics, 2025b). Gemini shares are derived from interactions aggregated across surfaces (App, AI Mode, API) classified into O*NET SOC occupations. OEWS data does not contain information on Military Specific Occupations so those are omitted. 

11 

**Table 1:** Over and Under-Represented Detailed Occupations Relative to US Employment 

|Most Over-represented|Most Under-represented|Largest occupations not<br>observed|
|---|---|---|
|Financial and Investment|Home Health and Personal|Food Preparation Workers|
|Analysts|Care Aides||
|Market Research Analysts|Fast Food and Counter<br>Workers|Cooks, Fast Food|
|Software Developers|Cashiers|Dining Room and Cafeteria<br>Attendants and Bartender<br>Helpers|
|Network and Computer|Retail Salespersons|Substitute Teachers,|
|Systems Administrators||Short-Term|



_Notes:_ Over/under-representation based on signed distance between Gemini and US employment shares. Gemini shares are derived from interactions aggregated across surfaces (App, AI Mode, API) classified into O*NET SOC occupations. O*NET SOC codes are mapped to corresponding SOC codes in the May 2024 OEWS data (Bureau of Labor Statistics, 2025b) to obtain US employment shares. OEWS data does not contain information on Military Specific Occupations so those are omitted. In addition, residual detailed occupation categories with titles including “All Other” are excluded due to uncertainty about the quality of classification into these labels and for consistency with other detailed occupation analysis in this section. Non-observation of occupations may come from a combination of the relevant workers not using AI and those groups being sufficiently small that they cannot be detected given the privacy protections we implement. 

Moving to global data, when comparing Gemini interactions from OECD<sup>8</sup> and non-OECD countries, we find that the usage from OECD countries is more disproportionately concentrated in “Computer and Mathematical” and “Business and Financial Operations” occupations. In contrast, interactions from non-OECD countries have a greater share of tasks associated with “Office and Administrative Support”, “Arts, Design, Entertainment, Sports, and Media”, and “Educational Instruction and Library” occupations. The occupation shares differ between country categories; the differences in the “Arts, Design, Entertainment, Sports, and Media” category appear particularly pronounced, with these occupations representing roughly 70% higher share of Gemini interactions in non-OECD countries (15.9%) vs OECD countries (9.4%). 

Looking at the detailed occupations within these categories, the ones most disproportionately represented in the OECD countries’ Gemini interactions include financial and investment analysts, network and computer systems administrators, credit analysts, human resource specialists, software developers, and accountants and auditors.<sup>9</sup> Meanwhile, the detailed occupations most disproportionately represented in non-OECD countries’ Gemini interactions include graphic designers, data entry keyers, photographers, instructional coordinators, and word processors and typists. 

The “Office and Administrative Support” occupations (data entry keyers, bookkeeping clerks, word processors and typists) which are more common in the non-OECD countries could point to the different nature of office work that may be exposed to AI usage in economies with different levels of development. Moving forward, it will be important to understand how AI usage evolves, 

> 8For all analyses referencing OECD groupings, note that Gemini data availability in Europe is more limited. In particular, API data is unavailable for classification. Therefore, the presence of coding applications (“Computer and Mathematical” occupations) are likely understated for the OECD. 

> 9Note that the current ATLAS sample was drawn from Gemini interactions in early April 2026. So, tax-related queries may be influencing the relative prominence of associated occupations. 

12 

**Figure 2:** Using Gemini for Work in Arts and Design Occupations is More Common in Non-OECD Countries While Computer and Math and Business and Finance Occupations Are More Common in the OECD 



_Notes:_ Gemini shares are derived from interactions aggregated across surfaces (App, AI Mode, API) based on the user’s country/region and classified into O*NET SOC occupations. This chart compares the broad occupation group shares in the 38 OECD member countries to non-OECD countries. 

13 

where the most valuable knowledge work occurs, and whether AI tools enable workers in less developed economies to perform more complex tasks or these differences are driven more by occupational composition, surface/API coverage, or product penetration. 

It is also worth noting the presence of graphic designers and photographers as occupations that are more prevalent in non-OECD countries’ Gemini interactions. Gemini usage associated with film and video editors, producers and directors, and special effects artists and animators is also more common in non-OECD countries. We observe substantially more multimodal usage in non-OECD countries. Gemini work-related conversations<sup>10</sup> are roughly twice as likely to include a generated image or video in non-OECD countries relative to OECD countries. Moreover, multimodal use is more than twice as common in work conversations relative to non-work conversations. There is also variation in media generation across regions, with it being most common in Africa and least common in Europe. 

## **3.4 Occupation and Task Coverage** 

Next, we turn our attention to considering the breadth of AI usage within the economy. Particularly, we consider the breadth of occupations where we observe non-negligible usage of AI tools and within those occupations, how comprehensively AI is being used to accomplish the constituent tasks. 

To measure occupation coverage, we consider the portion of the sample of almost 15 million Gemini interactions classified as work-related, which are assigned to O*NET tasks and occupations. Within each of the major occupation groups, we calculate the share of the associated detailed occupations where we observe tasks being completed by a minimum number of users (50 globally). These results are in Figure 3. In aggregate, we observe usage above these thresholds in 68% of detailed occupations globally but there is substantial variation across major occupation groups. We observe greater task coverage in detailed occupations in occupation groups, such as “Computer and Mathematical”, “Legal”, and “Management” occupations, which contain more office work.<sup>11</sup> The detailed occupations we observe above the stated minimum usage globally represent 88.4% of employed civilian workers in the US.<sup>12</sup> 

Each detailed occupation in the O*NET data is associated with a set of constituent tasks, which cover the work done in that occupation. We measure the individual O*NET tasks where we observe Gemini usage globally across a minimum set of (25) users. Overall, we observe roughly 20% of tasks meeting this usage threshold in our sample. For each detailed occupation, we calculate the share of tasks where we have achieved this level of saturation. For 29% of detailed occupations, we observe zero task saturation. That is, for none of their tasks do we observe at least 25 users attempting that task with Gemini. This includes occupations such as stockers and 

> 10Image generation data is only available for Gemini App. 

> 11Note that there are differing numbers of detailed occupations within each broad category. For instance, there are only 7 detailed Legal occupations while there are 50 Office and Administrative Support Occupations. However, the rankings of occupational coverage in Figure 3 reveal an interesting divergence from the volume-based employment shares. For example, Legal occupations exhibit broad coverage across detailed roles even though their overall interaction volume remains modest relative to tech or finance professions. 

> 12In the absence of global employment data mapped to US occupation classifications (SOC), we currently rely on US employment statistics (Bureau of Labor Statistics, 2025b) to illustrate the materiality of the occupations observed in our data. We intend to continue exploring global AI usage related to work in future reports. 

14 

**Figure 3:** Gemini Usage is Observed Across 68% of Detailed Occupations, Including the Vast Majority of White-Collar Professions 



_Notes:_ This chart uses the 22 non-military SOC major occupation groups on the vertical axis and for each of those groups, depicts the share of component detailed occupations where we observe at least 50 Gemini users. The Gemini usage shares are derived from interactions aggregated across surfaces (App, AI Mode, API) classified into O*NET SOC occupations. O*NET SOC codes are mapped to corresponding SOC codes in the May 2024 OEWS data (Bureau of Labor Statistics, 2025b) so that US employment shares can be calculated. Military Specific Occupations are omitted and residual detailed occupation categories with titles including “All Other” are excluded for consistency with other detailed occupation analysis in this section. Data are also not present for code 45-3031 (Fishing and Hunting Workers). Therefore, the 761 remaining OEWS SOC occupations are the relevant universe of occupations used in this figure. 

15 

order fillers, miscellaneous assemblers and fabricators, food preparation workers, fast food cooks, refuse and recyclable material collectors, and police and sheriff’s patrol officers. 

Around 30% of occupations had at least a quarter of their tasks observed with Gemini usage above our threshold.<sup>13</sup> For 11% of occupations, half of their tasks had observed Gemini usage. For 3% of occupations, at least three-quarters of their tasks were saturated.<sup>14</sup> The latter group includes occupations like software quality assurance analysts and testers, human resources specialists, and document management specialists (See Table 2). 

For the group of occupations where at least one task has above the threshold number of user interactions, we observe a median task saturation of 21%. In other words, among occupations where we observe meaningful AI usage, workers are using AI for about a fifth of their occupation’s tasks at the median. This conditional distribution is presented in Figure 4.<sup>15</sup> 

Taken together, these results offer possible support for the notion that AI is currently serving primarily as a complement to existing work. In line with classic determinants of technology-driven productivity dispersion across workers and organizations (Syverson, 2011), AI appears useful for a subset of tasks performed within occupations, but they do not currently appear to be comprehensively used for performing the work currently done by humans. It is possible that levels of saturation may grow as new AI breakthroughs emerge. It is also possible that novel workflows and tasks will develop around evolving AI capabilities that will maintain a degree of complementarity between workers and AI systems. 

## **3.5 Task characteristics** 

We have seen that there is substantial variation in the extent to which an occupation’s tasks are being performed with AI. Next, we explore the attributes of tasks which affect how much AI usage we observe in our data. We also attempt to detail the relationship between that AI usage and human work. It is critical to acknowledge that AI usage is not synonymous with automation (the substitution of human effort with machines for specific tasks). Instead, workers can also use AI tools for collaboration (the complementary enhancement of human productivity). Moreover, the type of tasks workers perform with AI will shape both the relevant labor market impacts and societal consequences of continued AI diffusion. If, for instance, AI enabled workers to offload 

> 13Comparing this to data from the Anthropic Economic Index, this is slightly lower than the 36% from Handa et al. (2025) and the reported “combined across reports” figure of 49% from Appel et al. (2026). Nonetheless, the different methodologies, both in terms of data sampling, as well as the stricter privacy preserving algorithm we enforce on our data does not make these figures not entirely comparable. 

> 14These occupation shares are based on the 923 detailed O*NET occupations. US employment data is only available for more aggregated 761 OEWS occupations used for Figure 3. A direct weighting of the detailed O*NET occupations within the OEWS taxonomy was unavailable. Therefore, estimating the employment covered at these thresholds requires some assumptions. We could 1) assume an OEWS occupation meets the relevant threshold if any of the constituent O*NET occupations did 2) require all of them to meet the threshold 3) estimate a share of the employment based on the share of constituent occupations meeting the threshold. (1) and (2) provide upper and lower bounds of coverage so we present those here. Occupations with at least a quarter of their tasks having AI usage cover 44-50% of US employment. Occupations with at least half of their tasks saturated cover 26-31% of US employment. Occupations with at least a three-quarters of their tasks having AI usage cover 9-10% of US employment. 

> 15Previous work on measuring AI exposure using O*NET task data have aggregated to the occupation level using O*NET’s task importance ratings but consistent with Eloundou et al. (2024), we do not observe substantial changes to our findings. Applying this weighting does not meaningfully impact the distribution of task saturation we observe in our data. (See Appendix C) 

16 

**Figure 4:** For Occupations with Observed Gemini Usage, Workers Are Generally Using AI for Less Than One Quarter of Their Tasks 



_Notes:_ This chart displays the distribution of task saturation across detailed occupations with non-zero AI usage. “Task Saturation” is defined as the percentage of O*NET tasks within an occupation that see meaningful interaction volume (at least 25 unique users globally). Occupations where zero tasks meet this threshold are excluded. The vertical axis represents a count of occupations, while the horizontal axis states what percentage of tasks are saturated in those occupations. Gemini shares are derived from interactions aggregated across surfaces (App, AI Mode, API) classified into O*NET SOC occupations. Military Specific Occupations so those are omitted and residual detailed occupation categories with titles including “All Other” are excluded for consistency with other detailed occupation analysis in this section. 

**Table 2:** Occupations With the Most/Least Task Saturation Among Those With Gemini Usage 

|Least Saturated|Most Saturated|
|---|---|
|Special Education Teachers, Middle School|Market Research Analysts and Marketing<br>Specialists|
|Kindergarten Teachers, Except Special|Human Resources Specialists|
|Education||
|Special Education Teachers, Preschool|Software Quality Assurance Analysts and<br>Testers|
|Midwives|Document Management Specialists|
|English Language and Literature Teachers,|Network and Computer Systems|
|Postsecondary|Administrators|



_Notes:_ Gemini shares are derived from interactions aggregated across surfaces (App, AI Mode, API) classified into O*NET SOC occupations. Military Specific Occupations so those are omitted and residual detailed occupation categories with titles including “All Other” are excluded for consistency with other detailed occupation analysis in this section. Saturation is defined as the share of all O*NET tasks associated with a detailed occupation where we observe at least 25 Gemini users. Occupations where zero tasks meet this threshold are excluded. 

17 

mundane or routine tasks, their time may be freed up to pursue more creative or enjoyable tasks. 

In order to better understand the distribution of AI task usage in our data, we use the prompt provided in Autor and Thompson (2025) to map ONET tasks to five categories<sup>16</sup> : Routine Cognitive (RC), Routine Manual (RM), Non-Routine Cognitive Analytic (NC), Non-Routine Manual (NM), and Non-Routine Interpersonal (NI). Under this categorization, routine tasks are ones that are codifiable, meaning they can be fully specified through a set of structured instructions or rules. Manual tasks involve physical labor. Cognitive tasks are those that involve cognitive processes. And, interpersonal tasks are ones that require communication, human interaction, and social skills. This taxonomy is grounded in how the labor market literature has conceptualized digital technology shocks in the past. Later on, we’ll discuss how what we observe with Gemini usage differs from the models put forward in that literature. 

In Figure 5, we compare the group of detailed O*NET occupations (29%) where we observed no tasks with sufficient usage across at least 25 users to the remaining occupations with non-zero saturation. What we observe is that the most salient feature on the extensive margin appears to be the physicality of the tasks in an occupation. Manual tasks represent higher shares of the constituent tasks in the occupations with zero task saturation. Cognitive and interpersonal tasks, especially non-routine cognitive tasks are more common in the occupations where we observe non-negligible AI usage across at least one of the component tasks. 

**Figure 5:** Occupations Without Substantial Gemini Usage Have Greater Shares of Manual Tasks 



_Notes:_ This figure uses the categories from Autor and Thompson (2025), assigning each O*NET task, covering occupations across the economy, to one of the five categories on the horizontal axis. It then compares the group of detailed O*NET occupations with zero task saturation (omitted from Figure 4) to the remaining occupations. We define a task as being saturated if we observe at least 25 unique users globally performing that task. An occupation falls in the zero saturation group if none of its component tasks meet this threshold. The shares here are the average of the within-occupation shares for the zero / non-zero task saturation groups. 

> 16The prompt used was taken from A.2 of the June 18 version of the working paper. Classification was performed with Gemini 3.1 Flash Lite. 

18 

As was described earlier, the literature has previously conceptualised digital technology shocks through the lens of skill-biased technological change (SBTC) and routine-biased technological change. In Autor et al. (2003) and Acemoglu and Autor (2011), traditional digitalisation waves diffused by automating routine cognitive and manual labour. This dynamic also meant enhanced productivity for a subset of skilled workers such that automation and augmentation were simultaneous phenomena. As digital technologies proliferated, they generally produced _job polarization_ , with rising demand for high-wage and low-wage labour, but a decline in the relative share of middle-wage work. 

Previously non-routine cognitive work, which required abstract reasoning, problem-solving, and interpersonal communication, tended to experience digital technology complementarity and corresponding wage gains. The decline in the middle skill jobs, meanwhile, was driven by rising demand for highly skilled labor but also a shift to low skilled work. LLMs such as Gemini could present a potential discontinuity with this understanding of technological automation and augmentation dynamics. Current AI systems exhibit advanced capabilities in reasoning, synthesis, textual generation, and multimodal execution, allowing them to perform broadening swathes of non-routine cognitive tasks. 

**Figure 6:** Non-Routine Cognitive Tasks Are Over-Represented in Gemini Usage Relative to the O*NET Task Universe While Manual and Interpersonal Tasks Are Under-Represented 



_Notes:_ This figure uses the categories from Autor and Thompson (2025), assigning each O*NET task, covering occupations across the economy, to one of the five categories on the vertical axis. The horizontal axis represents the shares of tasks in each of those categories for the relevant distribution, starting with the O*NET task universe. It then compares the O*NET taxonomy distribution to the representation of work-related tasks in the ATLAS data. Gemini shares are derived from interactions aggregated across surfaces (App, AI Mode, API) classified into O*NET task ids. The two Gemini data points for each category represent shares based on a) whether an O*NET task appears in the Gemini data with at least 25 users b) the number of interactions associated with each task. 

19 

On the intensive margin<sup>17</sup> , we again rely on the Autor and Thompson (2025) task categories applied to O*NET tasks to uncover the types of tasks where we observe more Gemini usage in our data. Our analysis unsurprisingly suggests a heavy concentration of Gemini interactions for cognitive domains. Cognitive tasks make up roughly half of the O*NET task taxonomy. Within the set of tasks where we observe non-negligible<sup>18</sup> Gemini usage, cognitive tasks—encompassing both routine and non-routine—account for 73% of the total, a figure that increases to 86% when considering Gemini interaction volume. In contrast, manual and interpersonal tasks are less represented in Gemini usage than in the O*NET taxonomy. Manual and interpersonal tasks make up 28% and 22% of the O*NET taxonomy, respectively, but comprise roughly 5% and 9% of the Gemini interaction volume. 

We note particular over-representation of Gemini usage for non-routine cognitive analytic tasks. The Autor and Thompson (2025) classifier identifies these tasks as those requiring analytical skills—such as judgment, strategic thinking, problem-solving, and creativity. These tasks are non-codifiable, meaning the rules for accomplishing them are not sufficiently well understood to be specified explicitly in computer code and executed by traditional machines. These are the tasks where AI unlocks potential that was challenging to realize with past paradigms of deterministic, rules-based computing. Non-routine cognitive analytic tasks comprise 35% of all O*NET tasks but 65% of Gemini interactions in our data. 

While we noted earlier that occupations where we don’t see tasks with substantial AI usage tend to have greater shares of manual tasks, we do observe some AI usage even within occupations with high manual task shares.<sup>19</sup> This usage is often in tasks that are complementary to manual work. For example, roughly 44% of Industrial Machinery Mechanics’ tasks are manual. However, we observe thousands of AI uses for non-routine cognitive tasks such as analyzing test results and machine error messages.<sup>20</sup> 

Other occupations that have above median shares of manual tasks and high AI usage for various tasks include electrical and electronics repairers (25% manual), computer user support specialists (19% manual), photographers (18% manual), and shipping, receiving, and inventory clerks (18% manual). 

We do also observe some AI usage for manual tasks, especially the non-routine variety, in certain occupations. For example, over ten thousand conversations in our sample relate to automotive service technicians and mechanics (83% manual) using AI for testing vehicle components and systems, rewiring systems, and inspecting parts for wear.<sup>21</sup> These occupations often also have higher multimodal usage. For example, automotive service technicians and mechanics have multimodal conversation shares more than 2 times higher than the average in work AI interactions. As we will see in the next section, the ways in which people use AI for manual tasks differs from their use for cognitive tasks. 

> 17As we observed earlier, there is a large majority of O*NET tasks where we do not observe substantial usage. For the remaining analyses, we focus on the intensive margin within this set of tasks with AI usage. Furthermore, note that this AI usage distribution across tasks is heavily skewed (with a skewness of greater than 16). The mean Gemini interaction volume at the mean is more than five times greater than the interaction volume at the median. At the 90th percentile, interaction volume is more than nine times greater than the median. 

> 18At least 25 users. 

> 19The median occupation’s tasks are 12.5% manual 

> 20O*NET task id 11821 

> 21O*NET task ids 23522, 23545, and 23541 

20 

