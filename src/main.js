import OpenAI from 'openai';
import { getStaticFile, throwIfMissing } from './utils.js';
import { Client, Databases, Query, ID } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  throwIfMissing(process.env, ['OPENAI_API_KEY', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_ENDPOINT', 'APPWRITE_API_KEY']);

  if (req.method === 'GET') {
    return res.send(getStaticFile('index.html'), 200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
  }

  // я думаю тут ответы пользвоателя а не ии надо сделать 
  let generatedAnswers = 'All information about project: '

  const body = JSON.parse(req.body)

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_API_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  const openai = new OpenAI();

  try {
    const groups = await databases.listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      'questionGroup'
    );

    for (const group of groups.documents) {
      const data = await databases.listDocuments(
        process.env.APPWRITE_DATABASE_ID,
        'question',
        [Query.equal('groupId', group.$id)]
      );

      const questionIds = data.documents.map(doc => doc.$id);

      const answers = await databases.listDocuments(
        process.env.APPWRITE_DATABASE_ID,
        'answer',
        [
          Query.contains('questionId', questionIds),
          Query.equal('projectId', body.projectId)
        ]
      );

      log('answers', JSON.stringify(answers));

      const project = await databases.getDocument(
        process.env.APPWRITE_DATABASE_ID,
        'project',
        body.projectId
      );

      const questionsWithAnswers = data.documents.filter(question => answers.documents.some(answer => answer.questionId === question.$id));

      log('info', JSON.stringify(questionsWithAnswers));

      // дата документс - тут список тем content каждого документа
      const prompt = generatePrompt(group.name, data.documents, answers.documents, group.content, project?.language);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        // model: 'gpt-3.5-turbo',
        // max_tokens: 15000,
        messages: [{ role: 'user', content: prompt + generatedAnswers  }],
      });

      const completion = response.choices[0].message.content;

      await databases.createDocument(
        process.env.APPWRITE_DATABASE_ID,
        'generatedDocuments',
        ID.unique(),
        {
          name: group.name,
          groupId: group.$id,
          content: completion,
          projectId: body.projectId
        }
      );
    }

    await databases.updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      'project',
      body.projectId,
      {
        generated: true
      }
    );

    return res.json({ ok: true }, 200);

  } catch (err) {
    log('error', JSON.stringify(err));
    error(err);
    log(err.message)
    return res.json({ ok: false, error: err.message }, 500);
  }

  function generatePrompt(groupName, questions, answers, content, language) {
    let prompt = `Create a detailed and comprehensive document on the topic: ${groupName}. With including content: ${content}`;

    questions.forEach(question => {
      const answer = answers.find(ans => ans.questionId === question.$id);
      prompt += `\n\n${question.label}\n`;

      generatedAnswers += `${question.label}: ${answer?.text}\n`

      if (answer) {
        prompt += `Answer: ${answer.text}\n`;
      }
    });
  
    prompt += `\n All content must be buetifyed with markdown. Send me text in markDown. НЕ СИЛЬНО ОФИЦИАЛЬНЫЙ СТИЛЬ, БОЛЬШЕ СТИЛЬ РЕСЕРЧА. Provide an in-depth description of the topic:
      - Delve deeply into each point, providing exhaustive information.
      - Include new information and analysis, not just rewriting provided data.
      - Take into account current data, the latest trends, and statistics from reliable sources.
      - Use the internet to search and analyze the necessary information.
      - Include statistics, data from open sources, research, and current reports.
      - Provide links to information sources.
      - Approach the task creatively.
      - Provide ideas and recommendations that will help improve the understanding of the topic.
      - Include tables, charts, calculations, and other visual elements for better data representation.
      - Provide specific examples and case studies that illustrate key points.
      - The document should be logical and structured.
      - Use subheadings, numbering, and lists to organize information.
      - Include an introduction, main content, and conclusion for each topic.
      - The document should be written in the third person.
      - Avoid using "our" and "my".
      - The information should be useful and applicable to a startup.
      - Include as much useful information as possible for each topic.
      - The document should be detailed and extensive.
      - If the topic allows, add tables, charts, calculations, and other visual elements for better understanding and illustration of information.
      - Don't use we us our. Describe a project
      - Не надо повторять то что писал пользователь. Он это знает. Твоя задача проанализировать и предоставить новую информацию!!!!!!!!!!
      - the document must be in ${language} language!!!`;
  
    return prompt;
  }
  
};

