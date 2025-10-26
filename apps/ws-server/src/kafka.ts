import { prismaClient } from "@repo/db/client";
import { Kafka, Producer , Consumer} from "kafkajs";




const kafka = new Kafka({
    
    clientId: "ws-server",
    brokers : [process.env.KAFKA_BROKER || "localhost:9092"],
});

let producer : Producer | null = null;

export async function getKafkaProducer() {
    if(producer) return producer;
    producer = kafka.producer();
    await producer.connect();
    console.log("Kafka producer connected");
    return producer;
    
}

export async function sendMessageToKafka(message : any, topic: string){
    try{
        const producer = await getKafkaProducer();
        await producer.send({
            topic,
            messages: [{value : JSON.stringify(message)}],
        })
    } catch (err){
        console.log("failed to send message to kafka : " , err);
    }
}

let consumer : Consumer | null = null;

export async function KafkaConsumer(){
    if(consumer) return consumer;

    consumer = kafka.consumer({groupId: "chat-group"});

    try{

        await consumer.connect();
        await consumer.subscribe({topic : "messages" , fromBeginning : false} ,);
        await consumer.subscribe({topic : "reactions" , fromBeginning : false} ,);

        await consumer.run({
            autoCommit : true,
            eachMessage : async({topic , partition , message}) => {
                if(!message.value) return;

                const value = message.value.toString();
                console.log(`Consumed from kafka[${topic}] : ${value}`);

                try{
                    const messageData = JSON.parse(value);
                    await prismaClient.chat.create({
                        data: {
                            message: messageData.message,
                            roomId: messageData.roomId,
                            userId: messageData.userId
                        },

                    });
                    console.log("Message persisited to db");
                } catch (dbErr){
                    console.log("failed to persist message : " , dbErr);
                }
            }
        });
        console.log("kafka consumer connected");
    
    } catch (err){
        console.log("failed to connect to kafka : " , err);
    }
    return consumer;
}