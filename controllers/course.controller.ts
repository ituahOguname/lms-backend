import { Response, Request, NextFunction } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import cloudinary from "cloudinary";
import CourseModel from "../models/course.model";
import { redis } from "../utils/redis";
import { createCourse, getAllCoursesService } from "../services/courses.services";
import mongoose from "mongoose";
import path from "path";
import ejs from "ejs";
import sendMail from "../utils/sendMail";
import NotificationModel from "../models/notification.model";


// upload course
export const uploadCourse = CatchAsyncError(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const data = req.body;
        const thumbnail = data.thumbnail;
        if(thumbnail){
            const myCloud = await cloudinary.v2.uploader.upload(thumbnail, {
                folder: "courses"
            });
            data.thumbnail = {
                public_id: myCloud.public_id,
                url: myCloud.secure_url
            }
        }
        createCourse(data, res, next)
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500));
    }
})

//edit course
export const editCourse = CatchAsyncError(async(req: Request, res:Response, next: NextFunction) => {
    try {
        const data = req.body;
        const thumbnail = data.thumbnail;
        const courseId = req.params.id;
        
        if(thumbnail){
            await cloudinary.v2.uploader.destroy(thumbnail.public_id);

            const myCloud = await cloudinary.v2.uploader.upload(thumbnail, {folder: "courses"});
            data.thumbnail = {
                public_id: myCloud.public_id,
                url: myCloud.secure_url,
            };
        }

        const course = await CourseModel.findByIdAndUpdate(courseId, {set: data}, {new: true});

        res.status(201).json({
            success: true,
            course,
        })

    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500))
    }
})

// get single course --- without purchasing (course preview)
export const getSingleCourse = CatchAsyncError(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const courseId = req.params.id;
        const cacheExists = await redis.get(courseId);

        // to speed up the fetch request
        if (cacheExists) {
            const course = JSON.parse(cacheExists);
            res.status(200).json({
                success: true,
                course,
            });
        } else {
            const course = await CourseModel.findById(req.params.id).select("-courseData.videoUrl -courseData.suggestion -courseData.questions -courseData.links");
            
            await redis.set(courseId, JSON.stringify(course), "EX", 604800);

            res.status(200).json({
                success: true,
                course,
            });
        }
        
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500))
    }
});

// get all courses -- without purchasing (course preview)
export const getAllCourses = CatchAsyncError(async(req:Request, res: Response, next: NextFunction)=> {
    try {
        const cacheExists = await redis.get("allCourses");
        if (cacheExists) {
            const courses = JSON.parse(cacheExists);
            res.status(200).json({
                success: true,
                courses
            })
        } else {
            const courses = await CourseModel.find().select("-courseData.videoUrl -courseData.suggestion -courseData.questions -courseData.links");

            await redis.set("allCourses", JSON.stringify(courses))

            res.status(200).json({
                success: true,
                courses,
            });
        }

        
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500))
    }
});

// get course content -- only for valid user
export const getCourseByUser = CatchAsyncError(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const userCourseList = req.user?.courses;
        const courseId = req.params.id;

        const courseExists = userCourseList?.find((course:any) => course._id.toSring() === courseId)

        if(!courseExists) {
            return next(new ErrorHandler("You are not eligible to access this course", 404))
        }

        const course = await CourseModel.findById(courseId);
        const content = course?.courseData

        res.status(200).json({
            success: true,
            content,
        })
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500));
    }
});


// add questions in course
interface IAddQuestionData {
    question: string;
    courseId: string;
    contentId: string;
}

export const addQuestion = CatchAsyncError(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const {question, courseId, contentId} = req.body as IAddQuestionData;
        const course = await CourseModel.findById(courseId);

        if (!mongoose.Types.ObjectId.isValid(contentId)) {
            return next(new ErrorHandler("Invalid content id", 400))
        }

        const courseContent = course?.courseData?.find((item:any) => item._id.equals(contentId));

        if (!courseContent) {
            return next(new ErrorHandler("Invalid contenet id", 400))
        }

        // create a new question object
        const newQuestion:any = {
            user: req.user,
            question,
            questionReplies: [],
        }

        // add the question to our course cintent
        courseContent.questions.push(newQuestion);

        await NotificationModel.create({
            user: req.user?._id,
            title: "New Question Recieved",
            message: `You have a new question in ${courseContent.title}`
        });

        // save the updated question
        await course?.save();

        res.status(200).json({
            success: true,
            course
        })
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500));
    }
});

// add question answer
interface IAddAnswerData{
    answer: string;
    courseId: string;
    contentId: string;
    questionId: string;
}

export const addAnswer = CatchAsyncError(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const {answer, courseId, contentId, questionId} = req.body as IAddAnswerData;

        const course = await CourseModel.findById(courseId);

        if (!mongoose.Types.ObjectId.isValid(contentId)) {
            return next(new ErrorHandler("Invalid content id", 400))
        }

        const courseContent = course?.courseData?.find((item:any) => item._id.equals(contentId));

        if (!courseContent) {
            return next(new ErrorHandler("Invalid contenet id", 400))
        }

        const question = courseContent?.questions?.find((item:any) => item._id.equals(questionId));

        if (!question) {
            return next(new ErrorHandler("Invalid question id", 400));
        }

        // create a new answer object
        const newAnswer: any = {
            user: req.user,
            answer,
        }

        // add this answer to our course content
        question.questionReplies.push(newAnswer);

        await course?.save();

        if (req.user?._id === question.user._id) {
            // create a notification
            await NotificationModel.create({
                user: req.user?._id,
                title: "New Question Reply Recieved",
                message: `You have a new reply in ${courseContent.title}`
            });
        } else {
            const data = {
                name: question.user.name,
                title: courseContent.title,
            }

            const html = await ejs.renderFile(path.join(__dirname, "../mails/question-reply.ejs"), data)

            try {
                await sendMail({
                    email: question.user.email,
                    subject: "Question Reply",
                    template: "question-reply.ejs",
                    data,
                })
            } catch (error:any) {
                return next(new ErrorHandler(error.message, 500))
            }
        }

        res.status(200).json({
            success: true,
            course,
        })

    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500));
    }
});

// add course review
interface IAddCourseReview {
    review: string;
    courseId: string;
    rating: number;
    userId: string;
}

export const addReview = CatchAsyncError(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const {review, rating} = req.body as IAddCourseReview;

        const userCourseList = req.user?.courses;
        const courseId = req.params.id;

        // check if the courseId already exists in userCourseList based on the id
        const courseExists = userCourseList?.some((course:any) => course._id.toString() === courseId.toString());

        if(!courseExists) {
            return next(new ErrorHandler("You are not eligible to access this course", 404))
        }

        const course = await CourseModel.findById(courseId);

        const reviewData:any = {
            user: req.user,
            rating,
            comment: review,
        }

        course?.reviews.push(reviewData);


        // course rating average calculation
        let avg = 0;

        course?.reviews.forEach((rev:any) => {
            avg += rev.rating;
        });

        if (course) {
            course.ratings = avg / course.reviews.length;
        }

        await course?.save();

        const notification = {
            title: "New Review",
            message: `${req.user?.name} has given a review on ${course?.name}`,
        }

        // create notification

        res.status(200).json({
            success: true,
            course,
        });

    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500));
    }
});

// add reply to review
interface IAddReviewReply {
    comment: string;
    courseId: string;
    reviewId: string;
}

export const addReviewReply = CatchAsyncError(async (req: Request, res:Response, next: NextFunction) => {
    try {
        const {comment, courseId, reviewId} = req.body as IAddReviewReply;

        const course = await CourseModel.findById(courseId) 

        if(!course) {
            return next(new ErrorHandler("Course not found", 404));
        }

        const review = course?.reviews?.find((rev:any) => rev._id.toString() === reviewId);

        if(!review) {
            return next(new ErrorHandler("Review not found", 404));
        }

        const  replyData:any = {
            user: req.user,
            comment,
        }

        if(!review.commentReplies) {
            review.commentReplies = [];
        }

        review.commentReplies?.push(replyData);

        await course?.save();

        res.status(200).json({
            sucess: true,
            course,
        })
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 500));
    }
});


// get all courses -- for only admin
export const getAllCoursesAdmin = CatchAsyncError(async (req:Request, res:Response, next: NextFunction) => {
    try {
       getAllCoursesService(res);
    } catch (error:any) {
        return next(new ErrorHandler(error.mesaage,400)); 
    }
});

// delete Course -- only for admin
export const deleteCourse = CatchAsyncError(async (req:Request, res:Response, next:NextFunction) => {
    try {
        const {id} = req.params;

        const course = await CourseModel.findById(id);

        if (!course) {
            return next(new ErrorHandler("User not found", 404));
        }

        await course.deleteOne({id});

        await redis.del(id);

        res.status(200).json({
            success: true,
            message: "Course deleted successfully",
        })
    } catch (error:any) {
        return next(new ErrorHandler(error.message, 400))
    }
});