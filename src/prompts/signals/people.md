---
title: Люди
agent: PeopleSignalAgent
query: comments people commenters leads pain points buyer intent objections requests audience participants
maxItems: 12
---
Собери людей только по конкретным пользователям из комментариев и явным людям из постов.
Каждый item — один конкретный человек из People/commenter signals.
Обязательно верни actorExternalId точно как в People/commenter signals.
Если есть username, верни personUsername без @. personName верни из personName.
Не пиши групповые items и не объединяй нескольких людей в один item.
Опиши наблюдаемый интерес, почему с ним может быть полезно познакомиться и мягкий повод для контакта.
Социальные роли и причину знакомства описывай в metrics с keys: profile, pain, lead_signal, offer, outreach_reason, intro_reason, helper_signal, question_signal, solution_need, contractor_need, similarity_reason.
tags для людей должны быть короткими темами или интересами, например AI, CRM, нетворк, найм, продажи, фокус, Петербург, образование; не используй profile, peer, активный, человек.
Для теплоты лида используй priority: high/medium/low.
Не оценивай личность, не делай чувствительные выводы, опирайся только на evidence.
